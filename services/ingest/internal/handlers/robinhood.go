package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/finagent/ingest/internal/models"
)

// PlaceCryptoOrder places or simulates a crypto order
func (h *Handlers) PlaceCryptoOrder(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req models.CryptoOrderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}

	// Validate request
	if err := h.validateCryptoOrderRequest(req); err != nil {
		h.respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Default to dry run for safety
	if req.DryRun == nil {
		dryRun := true
		req.DryRun = &dryRun
	}

	// Check rate limits
	if err := h.checkOrderRateLimit(ctx, req.UserID); err != nil {
		h.respondError(w, http.StatusTooManyRequests, "Rate limit exceeded")
		return
	}

	// Create order record
	orderID, err := h.createCryptoOrder(ctx, req)
	if err != nil {
		h.respondError(w, http.StatusInternalServerError, "Failed to create order")
		return
	}

	// Process order
	if *req.DryRun {
		// Simulate order
		if err := h.simulateCryptoOrder(ctx, orderID, req); err != nil {
			h.respondError(w, http.StatusInternalServerError, "Failed to simulate order")
			return
		}
	} else {
		// Place real order (if Robinhood client is configured)
		if err := h.placeRealCryptoOrder(ctx, orderID, req); err != nil {
			h.respondError(w, http.StatusInternalServerError, "Failed to place real order")
			return
		}
	}

	// Get the created order
	order, err := h.getCryptoOrder(ctx, orderID)
	if err != nil {
		h.respondError(w, http.StatusInternalServerError, "Failed to retrieve order")
		return
	}

	h.respondSuccess(w, map[string]interface{}{
		"order":   order,
		"dry_run": *req.DryRun,
		"message": h.getOrderMessage(*req.DryRun, req.Side, req.Symbol),
	})
}

func (h *Handlers) validateCryptoOrderRequest(req models.CryptoOrderRequest) error {
	if req.UserID == "" {
		return fmt.Errorf("user_id is required")
	}
	if req.Symbol == "" {
		return fmt.Errorf("symbol is required")
	}
	if req.Side != "buy" && req.Side != "sell" {
		return fmt.Errorf("side must be 'buy' or 'sell'")
	}
	if req.Quantity <= 0 {
		return fmt.Errorf("quantity must be positive")
	}

	// Validate quantity limits
	if req.Quantity > 1000000 { // Max order size
		return fmt.Errorf("quantity exceeds maximum allowed")
	}

	// For sell orders, check if user has sufficient balance
	if req.Side == "sell" && (req.DryRun == nil || !*req.DryRun) {
		// This would check actual balance
		// For now, just a placeholder
	}

	return nil
}

func (h *Handlers) checkOrderRateLimit(ctx context.Context, userID string) error {
	// Check Redis for rate limiting
	key := fmt.Sprintf("order_rate_limit:%s", userID)
	count, err := h.redis.Get(ctx, key).Int()
	if err != nil && err.Error() != "redis: nil" {
		return err
	}

	// Allow 10 orders per minute
	if count >= 10 {
		return fmt.Errorf("rate limit exceeded")
	}

	// Increment counter
	pipe := h.redis.Pipeline()
	pipe.Incr(ctx, key)
	pipe.Expire(ctx, key, time.Minute)
	_, err = pipe.Exec(ctx)
	return err
}

func (h *Handlers) createCryptoOrder(ctx context.Context, req models.CryptoOrderRequest) (string, error) {
	var orderID string
	err := h.db.Pool.QueryRow(ctx, `
		INSERT INTO crypto_orders (user_id, symbol, side, quantity, order_type, 
								 price, status, dry_run, placed_at)
		VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, NOW())
		RETURNING id
	`, req.UserID, req.Symbol, req.Side, req.Quantity, 
		getOrderType(req), req.Price, *req.DryRun).Scan(&orderID)
	
	return orderID, err
}

func (h *Handlers) simulateCryptoOrder(ctx context.Context, orderID string, req models.CryptoOrderRequest) error {
	// Simulate order execution with random delay
	go func() {
		time.Sleep(time.Duration(1+time.Now().Unix()%3) * time.Second)
		
		// Update order as filled
		simulatedPrice := h.getSimulatedPrice(req.Symbol)
		_, err := h.db.Pool.Exec(context.Background(), `
			UPDATE crypto_orders 
			SET status = 'filled', 
				filled_quantity = quantity, 
				average_fill_price = $2,
				filled_at = NOW(),
				updated_at = NOW()
			WHERE id = $1
		`, orderID, simulatedPrice)
		
		if err != nil {
			fmt.Printf("Failed to update simulated order: %v\n", err)
		}
	}()

	return nil
}

func (h *Handlers) placeRealCryptoOrder(ctx context.Context, orderID string, req models.CryptoOrderRequest) error {
	// Place real order through Robinhood client
	if h.rhClient == nil {
		return fmt.Errorf("Robinhood client not configured")
	}

	// This would integrate with actual Robinhood API
	rhOrderID, err := h.rhClient.PlaceOrder(req.Symbol, req.Side, req.Quantity, req.Price)
	if err != nil {
		// Update order status to failed
		h.db.Pool.Exec(ctx, `
			UPDATE crypto_orders 
			SET status = 'failed', error_message = $2, updated_at = NOW()
			WHERE id = $1
		`, orderID, err.Error())
		return err
	}

	// Update order with Robinhood order ID
	_, err = h.db.Pool.Exec(ctx, `
		UPDATE crypto_orders 
		SET robinhood_order_id = $2, status = 'submitted', updated_at = NOW()
		WHERE id = $1
	`, orderID, rhOrderID)

	return err
}

func (h *Handlers) getCryptoOrder(ctx context.Context, orderID string) (*models.CryptoOrder, error) {
	var order models.CryptoOrder
	err := h.db.Pool.QueryRow(ctx, `
		SELECT id, user_id, symbol, side, quantity, order_type, price,
			   status, dry_run, filled_quantity, average_fill_price,
			   fees, placed_at, filled_at, error_message
		FROM crypto_orders
		WHERE id = $1
	`, orderID).Scan(
		&order.ID, &order.UserID, &order.Symbol, &order.Side,
		&order.Quantity, &order.OrderType, &order.Price,
		&order.Status, &order.DryRun, &order.FilledQuantity,
		&order.AverageFillPrice, &order.Fees, &order.PlacedAt,
		&order.FilledAt, &order.ErrorMessage,
	)
	
	if err != nil {
		return nil, err
	}
	
	return &order, nil
}

func (h *Handlers) getOrderMessage(dryRun bool, side, symbol string) string {
	if dryRun {
		return fmt.Sprintf("Simulated %s order for %s created successfully", side, symbol)
	}
	return fmt.Sprintf("Real %s order for %s submitted to Robinhood", side, symbol)
}

func (h *Handlers) getSimulatedPrice(symbol string) float64 {
	// Return simulated prices for common crypto symbols
	prices := map[string]float64{
		"BTC":  45000.00 + (time.Now().Unix()%1000 - 500),
		"ETH":  3200.00 + (time.Now().Unix()%200 - 100),
		"DOGE": 0.08 + float64(time.Now().Unix()%10-5)/1000,
		"ADA":  0.45 + float64(time.Now().Unix()%20-10)/1000,
		"SOL":  95.00 + (time.Now().Unix()%50 - 25),
	}
	
	if price, exists := prices[symbol]; exists {
		return price
	}
	
	// Default price for unknown symbols
	return 1.00 + float64(time.Now().Unix()%100)/100
}

func getOrderType(req models.CryptoOrderRequest) string {
	if req.Price != nil && *req.Price > 0 {
		return "limit"
	}
	return "market"
}