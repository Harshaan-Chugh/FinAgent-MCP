package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/finagent/ingest/internal/database"
	"github.com/finagent/ingest/internal/models"
	"github.com/finagent/ingest/internal/plaid"
	"github.com/finagent/ingest/internal/robinhood"
	"github.com/go-redis/redis/v8"
	"github.com/jackc/pgx/v5"
)

type Handlers struct {
	db          *database.Database
	redis       *redis.Client
	plaidClient *plaid.Client
	rhClient    *robinhood.Client
}

func New(db *database.Database, redis *redis.Client, plaidClient *plaid.Client, rhClient *robinhood.Client) *Handlers {
	return &Handlers{
		db:          db,
		redis:       redis,
		plaidClient: plaidClient,
		rhClient:    rhClient,
	}
}

type APIResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
	Meta    interface{} `json:"meta,omitempty"`
}

func (h *Handlers) respondJSON(w http.ResponseWriter, statusCode int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(data)
}

func (h *Handlers) respondError(w http.ResponseWriter, statusCode int, message string) {
	h.respondJSON(w, statusCode, APIResponse{
		Success: false,
		Error:   message,
	})
}

func (h *Handlers) respondSuccess(w http.ResponseWriter, data interface{}) {
	h.respondJSON(w, http.StatusOK, APIResponse{
		Success: true,
		Data:    data,
	})
}

// HealthCheck returns service health status
func (h *Handlers) HealthCheck(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Check database connection
	if err := h.db.Pool.Ping(ctx); err != nil {
		h.respondError(w, http.StatusServiceUnavailable, "Database connection failed")
		return
	}

	// Check Redis connection
	if err := h.redis.Ping(ctx).Err(); err != nil {
		h.respondError(w, http.StatusServiceUnavailable, "Redis connection failed")
		return
	}

	h.respondSuccess(w, map[string]interface{}{
		"status":    "healthy",
		"timestamp": time.Now().UTC(),
		"service":   "finagent-ingest",
	})
}

// GetAccounts returns user accounts
func (h *Handlers) GetAccounts(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := r.URL.Query().Get("user_id")

	if userID == "" {
		h.respondError(w, http.StatusBadRequest, "user_id is required")
		return
	}

	query := `
		SELECT a.id, a.name, a.mask, a.official_name, a.type, a.subtype, 
		       a.currency, a.balance_current, a.balance_available, a.balance_limit,
		       a.is_closed, a.updated_at
		FROM accounts a
		WHERE a.user_id = $1 AND a.is_closed = false
		ORDER BY a.name
	`

	rows, err := h.db.Pool.Query(ctx, query, userID)
	if err != nil {
		h.respondError(w, http.StatusInternalServerError, "Failed to query accounts")
		return
	}
	defer rows.Close()

	var accounts []models.Account
	for rows.Next() {
		var acc models.Account
		err := rows.Scan(
			&acc.ID, &acc.Name, &acc.Mask, &acc.OfficialName,
			&acc.Type, &acc.Subtype, &acc.Currency,
			&acc.BalanceCurrent, &acc.BalanceAvailable, &acc.BalanceLimit,
			&acc.IsClosed, &acc.UpdatedAt,
		)
		if err != nil {
			h.respondError(w, http.StatusInternalServerError, "Failed to scan account")
			return
		}
		accounts = append(accounts, acc)
	}

	h.respondSuccess(w, map[string]interface{}{
		"accounts": accounts,
		"count":    len(accounts),
	})
}

// GetTransactions returns user transactions with filtering
func (h *Handlers) GetTransactions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := r.URL.Query().Get("user_id")
	startDate := r.URL.Query().Get("start")
	endDate := r.URL.Query().Get("end")
	merchant := r.URL.Query().Get("merchant")
	category := r.URL.Query().Get("category")
	limit := r.URL.Query().Get("limit")

	if userID == "" {
		h.respondError(w, http.StatusBadRequest, "user_id is required")
		return
	}

	// Default date range (last 30 days)
	if startDate == "" {
		startDate = time.Now().AddDate(0, 0, -30).Format("2006-01-02")
	}
	if endDate == "" {
		endDate = time.Now().Format("2006-01-02")
	}

	// Default limit
	limitInt := 100
	if limit != "" {
		if l, err := strconv.Atoi(limit); err == nil && l > 0 && l <= 1000 {
			limitInt = l
		}
	}

	// Build query
	query := `
		SELECT t.id, t.account_id, t.date, t.amount, t.merchant_name,
		       t.category, t.category_detailed, t.description, t.is_pending,
		       a.name as account_name, a.mask as account_mask
		FROM transactions t
		JOIN accounts a ON t.account_id = a.id
		WHERE t.user_id = $1 AND t.date >= $2 AND t.date <= $3
	`

	args := []interface{}{userID, startDate, endDate}
	argIndex := 4

	if merchant != "" {
		query += fmt.Sprintf(" AND t.merchant_name ILIKE $%d", argIndex)
		args = append(args, "%"+merchant+"%")
		argIndex++
	}

	if category != "" {
		query += fmt.Sprintf(" AND $%d = ANY(t.category)", argIndex)
		args = append(args, category)
		argIndex++
	}

	query += " ORDER BY t.date DESC, t.amount DESC"
	query += fmt.Sprintf(" LIMIT $%d", argIndex)
	args = append(args, limitInt)

	rows, err := h.db.Pool.Query(ctx, query, args...)
	if err != nil {
		h.respondError(w, http.StatusInternalServerError, "Failed to query transactions")
		return
	}
	defer rows.Close()

	var transactions []models.Transaction
	for rows.Next() {
		var txn models.Transaction
		err := rows.Scan(
			&txn.ID, &txn.AccountID, &txn.Date, &txn.Amount,
			&txn.MerchantName, &txn.Category, &txn.CategoryDetailed,
			&txn.Description, &txn.IsPending,
			&txn.AccountName, &txn.AccountMask,
		)
		if err != nil {
			h.respondError(w, http.StatusInternalServerError, "Failed to scan transaction")
			return
		}
		transactions = append(transactions, txn)
	}

	h.respondSuccess(w, map[string]interface{}{
		"transactions": transactions,
		"count":        len(transactions),
		"filters": map[string]interface{}{
			"start_date": startDate,
			"end_date":   endDate,
			"merchant":   merchant,
			"category":   category,
			"limit":      limitInt,
		},
	})
}

// GetHoldings returns user investment holdings
func (h *Handlers) GetHoldings(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := r.URL.Query().Get("user_id")

	if userID == "" {
		h.respondError(w, http.StatusBadRequest, "user_id is required")
		return
	}

	query := `
		SELECT h.id, h.account_id, h.quantity, h.institution_price, 
		       h.institution_value, h.cost_basis, h.last_refresh,
		       s.symbol, s.name as security_name, s.cusip, s.currency,
		       a.name as account_name, a.mask as account_mask
		FROM holdings h
		JOIN securities s ON h.security_id = s.id
		JOIN accounts a ON h.account_id = a.id
		WHERE h.user_id = $1
		ORDER BY h.institution_value DESC NULLS LAST
	`

	rows, err := h.db.Pool.Query(ctx, query, userID)
	if err != nil {
		h.respondError(w, http.StatusInternalServerError, "Failed to query holdings")
		return
	}
	defer rows.Close()

	var holdings []models.Holding
	totalValue := 0.0

	for rows.Next() {
		var holding models.Holding
		err := rows.Scan(
			&holding.ID, &holding.AccountID, &holding.Quantity,
			&holding.InstitutionPrice, &holding.InstitutionValue,
			&holding.CostBasis, &holding.LastRefresh,
			&holding.Symbol, &holding.SecurityName, &holding.CUSIP,
			&holding.Currency, &holding.AccountName, &holding.AccountMask,
		)
		if err != nil {
			h.respondError(w, http.StatusInternalServerError, "Failed to scan holding")
			return
		}

		if holding.InstitutionValue != nil {
			totalValue += *holding.InstitutionValue
		}

		holdings = append(holdings, holding)
	}

	h.respondSuccess(w, map[string]interface{}{
		"holdings":    holdings,
		"count":       len(holdings),
		"total_value": totalValue,
	})
}

// GetInvestmentTransactions returns user investment transactions
func (h *Handlers) GetInvestmentTransactions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := r.URL.Query().Get("user_id")
	startDate := r.URL.Query().Get("start")
	endDate := r.URL.Query().Get("end")
	limit := r.URL.Query().Get("limit")

	if userID == "" {
		h.respondError(w, http.StatusBadRequest, "user_id is required")
		return
	}

	// Default date range (last 90 days)
	if startDate == "" {
		startDate = time.Now().AddDate(0, 0, -90).Format("2006-01-02")
	}
	if endDate == "" {
		endDate = time.Now().Format("2006-01-02")
	}

	limitInt := 100
	if limit != "" {
		if l, err := strconv.Atoi(limit); err == nil && l > 0 && l <= 500 {
			limitInt = l
		}
	}

	query := `
		SELECT it.id, it.account_id, it.date, it.name, it.quantity,
		       it.amount, it.price, it.fees, it.type, it.subtype,
		       s.symbol, s.name as security_name,
		       a.name as account_name, a.mask as account_mask
		FROM investment_transactions it
		LEFT JOIN securities s ON it.security_id = s.id
		JOIN accounts a ON it.account_id = a.id
		WHERE it.user_id = $1 AND it.date >= $2 AND it.date <= $3
		ORDER BY it.date DESC
		LIMIT $4
	`

	rows, err := h.db.Pool.Query(ctx, query, userID, startDate, endDate, limitInt)
	if err != nil {
		h.respondError(w, http.StatusInternalServerError, "Failed to query investment transactions")
		return
	}
	defer rows.Close()

	var transactions []models.InvestmentTransaction
	for rows.Next() {
		var txn models.InvestmentTransaction
		err := rows.Scan(
			&txn.ID, &txn.AccountID, &txn.Date, &txn.Name,
			&txn.Quantity, &txn.Amount, &txn.Price, &txn.Fees,
			&txn.Type, &txn.Subtype, &txn.Symbol, &txn.SecurityName,
			&txn.AccountName, &txn.AccountMask,
		)
		if err != nil {
			h.respondError(w, http.StatusInternalServerError, "Failed to scan investment transaction")
			return
		}
		transactions = append(transactions, txn)
	}

	h.respondSuccess(w, map[string]interface{}{
		"investment_transactions": transactions,
		"count":                   len(transactions),
	})
}

// GetCryptoPositions returns user crypto positions
func (h *Handlers) GetCryptoPositions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := r.URL.Query().Get("user_id")

	if userID == "" {
		h.respondError(w, http.StatusBadRequest, "user_id is required")
		return
	}

	query := `
		SELECT id, symbol, name, quantity, average_price, market_value,
		       cost_basis, unrealized_pnl, last_price, price_change_24h,
		       price_change_percent_24h, last_refresh
		FROM crypto_positions
		WHERE user_id = $1
		ORDER BY market_value DESC NULLS LAST
	`

	rows, err := h.db.Pool.Query(ctx, query, userID)
	if err != nil {
		h.respondError(w, http.StatusInternalServerError, "Failed to query crypto positions")
		return
	}
	defer rows.Close()

	var positions []models.CryptoPosition
	totalValue := 0.0

	for rows.Next() {
		var pos models.CryptoPosition
		err := rows.Scan(
			&pos.ID, &pos.Symbol, &pos.Name, &pos.Quantity,
			&pos.AveragePrice, &pos.MarketValue, &pos.CostBasis,
			&pos.UnrealizedPnL, &pos.LastPrice, &pos.PriceChange24h,
			&pos.PriceChangePercent24h, &pos.LastRefresh,
		)
		if err != nil {
			h.respondError(w, http.StatusInternalServerError, "Failed to scan crypto position")
			return
		}

		if pos.MarketValue != nil {
			totalValue += *pos.MarketValue
		}

		positions = append(positions, pos)
	}

	h.respondSuccess(w, map[string]interface{}{
		"positions":   positions,
		"count":       len(positions),
		"total_value": totalValue,
	})
}

// GetMetrics returns basic service metrics
func (h *Handlers) GetMetrics(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Get some basic metrics from database
	var userCount, accountCount, transactionCount int

	err := h.db.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM users").Scan(&userCount)
	if err != nil && err != pgx.ErrNoRows {
		userCount = 0
	}

	err = h.db.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM accounts WHERE is_closed = false").Scan(&accountCount)
	if err != nil && err != pgx.ErrNoRows {
		accountCount = 0
	}

	err = h.db.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM transactions WHERE date >= CURRENT_DATE - INTERVAL '30 days'").Scan(&transactionCount)
	if err != nil && err != pgx.ErrNoRows {
		transactionCount = 0
	}

	metrics := map[string]interface{}{
		"users":                  userCount,
		"active_accounts":        accountCount,
		"transactions_last_30d":  transactionCount,
		"timestamp":              time.Now().UTC(),
		"service_uptime_seconds": time.Since(time.Now().Add(-time.Hour)).Seconds(), // placeholder
	}

	h.respondJSON(w, http.StatusOK, metrics)
}
