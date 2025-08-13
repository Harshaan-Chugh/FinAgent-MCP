package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

type APIResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
	Meta    interface{} `json:"meta,omitempty"`
}

func respondJSON(w http.ResponseWriter, statusCode int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(data)
}

func respondSuccess(w http.ResponseWriter, data interface{}) {
	respondJSON(w, http.StatusOK, APIResponse{
		Success: true,
		Data:    data,
	})
}

func respondError(w http.ResponseWriter, statusCode int, message string) {
	respondJSON(w, statusCode, APIResponse{
		Success: false,
		Error:   message,
	})
}

func healthCheck(w http.ResponseWriter, r *http.Request) {
	respondSuccess(w, map[string]interface{}{
		"status":    "healthy",
		"timestamp": time.Now().UTC(),
		"service":   "finagent-ingest",
	})
}

func getAccounts(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		respondError(w, http.StatusBadRequest, "user_id is required")
		return
	}

	// Mock data for testing
	accounts := []map[string]interface{}{
		{
			"id":               "acc_dev_checking",
			"name":             "Chase Checking",
			"mask":             "0000",
			"official_name":    "Chase Total Checking",
			"type":             "depository",
			"subtype":          "checking",
			"currency":         "USD",
			"balance_current":  1250.55,
			"balance_available": 1200.55,
			"is_closed":        false,
			"updated_at":       time.Now().UTC(),
		},
		{
			"id":               "acc_dev_savings",
			"name":             "Chase Savings",
			"mask":             "1111", 
			"official_name":    "Chase Savings",
			"type":             "depository",
			"subtype":          "savings",
			"currency":         "USD",
			"balance_current":  5025.10,
			"balance_available": 5025.10,
			"is_closed":        false,
			"updated_at":       time.Now().UTC(),
		},
	}

	respondSuccess(w, map[string]interface{}{
		"accounts": accounts,
		"count":    len(accounts),
	})
}

func getCryptoPositions(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		respondError(w, http.StatusBadRequest, "user_id is required")
		return
	}

	// Mock crypto positions
	positions := []map[string]interface{}{
		{
			"id":                      "pos_btc",
			"symbol":                  "BTC",
			"name":                    "Bitcoin",
			"quantity":                0.05,
			"average_price":           45000.00,
			"market_value":            2250.00,
			"cost_basis":              2000.00,
			"unrealized_pnl":          250.00,
			"last_price":              45000.00,
			"price_change_24h":        500.00,
			"price_change_percent_24h": 1.12,
			"last_refresh":            time.Now().UTC(),
		},
		{
			"id":                      "pos_eth",
			"symbol":                  "ETH",
			"name":                    "Ethereum",
			"quantity":                2.5,
			"average_price":           3200.00,
			"market_value":            8000.00,
			"cost_basis":              7500.00,
			"unrealized_pnl":          500.00,
			"last_price":              3200.00,
			"price_change_24h":        50.00,
			"price_change_percent_24h": 1.58,
			"last_refresh":            time.Now().UTC(),
		},
	}

	totalValue := 0.0
	for _, pos := range positions {
		if mv, ok := pos["market_value"].(float64); ok {
			totalValue += mv
		}
	}

	respondSuccess(w, map[string]interface{}{
		"positions":   positions,
		"count":       len(positions),
		"total_value": totalValue,
	})
}

func main() {
	// Setup routes
	r := chi.NewRouter()

	// Middleware
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))

	// CORS configuration
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"http://localhost:3000", "http://localhost:3001"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Health check
	r.Get("/healthz", healthCheck)

	// Read endpoints for MCP server
	r.Route("/read", func(r chi.Router) {
		r.Get("/accounts", getAccounts)
	})

	// Robinhood endpoints  
	r.Route("/rh", func(r chi.Router) {
		r.Get("/positions", getCryptoPositions)
	})

	// Start server
	port := "8081"
	if p := os.Getenv("PORT"); p != "" {
		port = p
	}

	server := &http.Server{
		Addr:    fmt.Sprintf(":%s", port),
		Handler: r,
	}

	// Start server in a goroutine
	go func() {
		log.Printf("Go ingestion service running on port %s", port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed to start: %v", err)
		}
	}()

	// Wait for interrupt signal to gracefully shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")
	log.Println("Server exited")
}