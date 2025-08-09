package models

import (
	"time"
)

// Account represents a financial account
type Account struct {
	ID               string     `json:"id"`
	Name             string     `json:"name"`
	Mask             *string    `json:"mask,omitempty"`
	OfficialName     *string    `json:"official_name,omitempty"`
	Type             string     `json:"type"`
	Subtype          *string    `json:"subtype,omitempty"`
	Currency         string     `json:"currency"`
	BalanceCurrent   *float64   `json:"balance_current,omitempty"`
	BalanceAvailable *float64   `json:"balance_available,omitempty"`
	BalanceLimit     *float64   `json:"balance_limit,omitempty"`
	IsClosed         bool       `json:"is_closed"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

// Transaction represents a financial transaction
type Transaction struct {
	ID               string     `json:"id"`
	AccountID        string     `json:"account_id"`
	Date             time.Time  `json:"date"`
	Amount           float64    `json:"amount"`
	MerchantName     *string    `json:"merchant_name,omitempty"`
	Category         []string   `json:"category,omitempty"`
	CategoryDetailed []string   `json:"category_detailed,omitempty"`
	Description      *string    `json:"description,omitempty"`
	IsPending        bool       `json:"is_pending"`
	AccountName      *string    `json:"account_name,omitempty"`
	AccountMask      *string    `json:"account_mask,omitempty"`
}

// Holding represents an investment holding
type Holding struct {
	ID                string     `json:"id"`
	AccountID         string     `json:"account_id"`
	Quantity          float64    `json:"quantity"`
	InstitutionPrice  *float64   `json:"institution_price,omitempty"`
	InstitutionValue  *float64   `json:"institution_value,omitempty"`
	CostBasis         *float64   `json:"cost_basis,omitempty"`
	LastRefresh       time.Time  `json:"last_refresh"`
	Symbol            *string    `json:"symbol,omitempty"`
	SecurityName      string     `json:"security_name"`
	CUSIP             *string    `json:"cusip,omitempty"`
	Currency          string     `json:"currency"`
	AccountName       string     `json:"account_name"`
	AccountMask       *string    `json:"account_mask,omitempty"`
}

// InvestmentTransaction represents an investment transaction
type InvestmentTransaction struct {
	ID           string     `json:"id"`
	AccountID    string     `json:"account_id"`
	Date         time.Time  `json:"date"`
	Name         string     `json:"name"`
	Quantity     *float64   `json:"quantity,omitempty"`
	Amount       float64    `json:"amount"`
	Price        *float64   `json:"price,omitempty"`
	Fees         *float64   `json:"fees,omitempty"`
	Type         string     `json:"type"`
	Subtype      *string    `json:"subtype,omitempty"`
	Symbol       *string    `json:"symbol,omitempty"`
	SecurityName *string    `json:"security_name,omitempty"`
	AccountName  string     `json:"account_name"`
	AccountMask  *string    `json:"account_mask,omitempty"`
}

// CryptoPosition represents a cryptocurrency position
type CryptoPosition struct {
	ID                     string     `json:"id"`
	Symbol                 string     `json:"symbol"`
	Name                   *string    `json:"name,omitempty"`
	Quantity               float64    `json:"quantity"`
	AveragePrice           *float64   `json:"average_price,omitempty"`
	MarketValue            *float64   `json:"market_value,omitempty"`
	CostBasis              *float64   `json:"cost_basis,omitempty"`
	UnrealizedPnL          *float64   `json:"unrealized_pnl,omitempty"`
	LastPrice              *float64   `json:"last_price,omitempty"`
	PriceChange24h         *float64   `json:"price_change_24h,omitempty"`
	PriceChangePercent24h  *float64   `json:"price_change_percent_24h,omitempty"`
	LastRefresh            time.Time  `json:"last_refresh"`
}

// CryptoOrder represents a cryptocurrency order
type CryptoOrder struct {
	ID               string     `json:"id"`
	UserID           string     `json:"user_id"`
	Symbol           string     `json:"symbol"`
	Side             string     `json:"side"`
	Quantity         float64    `json:"quantity"`
	OrderType        string     `json:"order_type"`
	Price            *float64   `json:"price,omitempty"`
	Status           string     `json:"status"`
	DryRun           bool       `json:"dry_run"`
	FilledQuantity   *float64   `json:"filled_quantity,omitempty"`
	AverageFillPrice *float64   `json:"average_fill_price,omitempty"`
	Fees             *float64   `json:"fees,omitempty"`
	PlacedAt         time.Time  `json:"placed_at"`
	FilledAt         *time.Time `json:"filled_at,omitempty"`
	ErrorMessage     *string    `json:"error_message,omitempty"`
}

// CryptoOrderRequest represents a request to place a crypto order
type CryptoOrderRequest struct {
	UserID   string   `json:"user_id"`
	Symbol   string   `json:"symbol"`
	Side     string   `json:"side"`
	Quantity float64  `json:"quantity"`
	Price    *float64 `json:"price,omitempty"`
	DryRun   *bool    `json:"dry_run,omitempty"`
}

// PlaidWebhook represents a webhook from Plaid
type PlaidWebhook struct {
	WebhookType         string                 `json:"webhook_type"`
	WebhookCode         string                 `json:"webhook_code"`
	ItemID              string                 `json:"item_id"`
	Error               interface{}            `json:"error,omitempty"`
	NewTransactions     int                    `json:"new_transactions,omitempty"`
	RemovedTransactions []string               `json:"removed_transactions,omitempty"`
	ConsentExpirationTime *time.Time           `json:"consent_expiration_time,omitempty"`
	Environment         string                 `json:"environment"`
	UserID              *string                `json:"user_id,omitempty"`
}

// PlaidAccount represents an account from Plaid API
type PlaidAccount struct {
	ID               string                 `json:"account_id"`
	Name             string                 `json:"name"`
	Mask             *string                `json:"mask"`
	OfficialName     *string                `json:"official_name"`
	Type             string                 `json:"type"`
	Subtype          *string                `json:"subtype"`
	Balances         PlaidBalance           `json:"balances"`
	VerificationStatus *string              `json:"verification_status"`
}

// PlaidBalance represents balance information from Plaid
type PlaidBalance struct {
	Current              *float64 `json:"current"`
	Available            *float64 `json:"available"`
	Limit                *float64 `json:"limit"`
	IsoCurrencyCode      *string  `json:"iso_currency_code"`
	UnofficialCurrencyCode *string `json:"unofficial_currency_code"`
}

// PlaidTransaction represents a transaction from Plaid API
type PlaidTransaction struct {
	ID                  string                   `json:"transaction_id"`
	AccountID           string                   `json:"account_id"`
	Date                string                   `json:"date"`
	Amount              float64                  `json:"amount"`
	MerchantName        *string                  `json:"merchant_name"`
	Name                string                   `json:"name"`
	Category            []string                 `json:"category"`
	CategoryDetailed    []string                 `json:"category_detailed"`
	Location            interface{}              `json:"location"`
	PaymentMeta         interface{}              `json:"payment_meta"`
	AccountOwner        *string                  `json:"account_owner"`
	Pending             bool                     `json:"pending"`
	TransactionCode     *string                  `json:"transaction_code"`
	IsoCurrencyCode     *string                  `json:"iso_currency_code"`
	UnofficialCurrencyCode *string               `json:"unofficial_currency_code"`
}

// SpendingSummary represents spending analysis
type SpendingSummary struct {
	TotalSpent       float64                    `json:"total_spent"`
	TotalIncome      float64                    `json:"total_income"`
	NetCashFlow      float64                    `json:"net_cash_flow"`
	TransactionCount int                        `json:"transaction_count"`
	Categories       []CategorySummary          `json:"categories"`
	Merchants        []MerchantSummary          `json:"merchants"`
	Period           Period                     `json:"period"`
}

// CategorySummary represents spending by category
type CategorySummary struct {
	Category        string  `json:"category"`
	Amount          float64 `json:"amount"`
	TransactionCount int    `json:"transaction_count"`
	Percentage      float64 `json:"percentage"`
}

// MerchantSummary represents spending by merchant
type MerchantSummary struct {
	Merchant        string  `json:"merchant"`
	Amount          float64 `json:"amount"`
	TransactionCount int    `json:"transaction_count"`
}

// Period represents a time period
type Period struct {
	StartDate string `json:"start_date"`
	EndDate   string `json:"end_date"`
	Days      int    `json:"days"`
}