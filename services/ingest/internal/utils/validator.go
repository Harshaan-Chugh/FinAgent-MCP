package utils

import (
	"errors"
	"fmt"
	"regexp"
	"time"
)

var (
	// EmailRegex validates email addresses
	EmailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
	
	// UUIDRegex validates UUID format
	UUIDRegex = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)
	
	// AccountIDRegex validates Plaid account IDs
	AccountIDRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)
	
	// CryptoSymbolRegex validates cryptocurrency symbols
	CryptoSymbolRegex = regexp.MustCompile(`^[A-Z]{2,10}$`)
	
	// DateRegex validates YYYY-MM-DD format
	DateRegex = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

// ValidationError represents a validation error
type ValidationError struct {
	Field   string
	Value   interface{}
	Message string
}

func (e ValidationError) Error() string {
	return fmt.Sprintf("validation error for field '%s' with value '%v': %s", e.Field, e.Value, e.Message)
}

// Validator provides validation utilities
type Validator struct{}

// NewValidator creates a new validator instance
func NewValidator() *Validator {
	return &Validator{}
}

// ValidateEmail checks if the email format is valid
func (v *Validator) ValidateEmail(email string) error {
	if email == "" {
		return ValidationError{Field: "email", Value: email, Message: "email cannot be empty"}
	}
	if !EmailRegex.MatchString(email) {
		return ValidationError{Field: "email", Value: email, Message: "invalid email format"}
	}
	return nil
}

// ValidateUUID checks if the UUID format is valid
func (v *Validator) ValidateUUID(uuid string) error {
	if uuid == "" {
		return ValidationError{Field: "uuid", Value: uuid, Message: "UUID cannot be empty"}
	}
	if !UUIDRegex.MatchString(uuid) {
		return ValidationError{Field: "uuid", Value: uuid, Message: "invalid UUID format"}
	}
	return nil
}

// ValidateAccountID checks if the account ID is valid
func (v *Validator) ValidateAccountID(accountID string) error {
	if accountID == "" {
		return ValidationError{Field: "account_id", Value: accountID, Message: "account ID cannot be empty"}
	}
	if len(accountID) > 128 {
		return ValidationError{Field: "account_id", Value: accountID, Message: "account ID too long (max 128 characters)"}
	}
	if !AccountIDRegex.MatchString(accountID) {
		return ValidationError{Field: "account_id", Value: accountID, Message: "invalid account ID format"}
	}
	return nil
}

// ValidateCryptoSymbol checks if the crypto symbol is valid
func (v *Validator) ValidateCryptoSymbol(symbol string) error {
	if symbol == "" {
		return ValidationError{Field: "symbol", Value: symbol, Message: "symbol cannot be empty"}
	}
	if !CryptoSymbolRegex.MatchString(symbol) {
		return ValidationError{Field: "symbol", Value: symbol, Message: "invalid crypto symbol format"}
	}
	
	// Check against known symbols
	validSymbols := map[string]bool{
		"BTC": true, "ETH": true, "DOGE": true, "LTC": true, "BCH": true,
		"ETC": true, "BSV": true, "ADA": true, "XRP": true, "SOL": true,
		"MATIC": true, "AVAX": true, "DOT": true, "LINK": true, "UNI": true,
		"ALGO": true, "ATOM": true, "XLM": true, "COMP": true, "AAVE": true,
	}
	
	if !validSymbols[symbol] {
		return ValidationError{Field: "symbol", Value: symbol, Message: "unsupported crypto symbol"}
	}
	
	return nil
}

// ValidateDate checks if the date format is valid (YYYY-MM-DD)
func (v *Validator) ValidateDate(date string) error {
	if date == "" {
		return ValidationError{Field: "date", Value: date, Message: "date cannot be empty"}
	}
	if !DateRegex.MatchString(date) {
		return ValidationError{Field: "date", Value: date, Message: "invalid date format, expected YYYY-MM-DD"}
	}
	
	// Parse to ensure it's a valid date
	_, err := time.Parse("2006-01-02", date)
	if err != nil {
		return ValidationError{Field: "date", Value: date, Message: "invalid date value"}
	}
	
	return nil
}

// ValidateDateRange checks if the date range is valid
func (v *Validator) ValidateDateRange(startDate, endDate string) error {
	if err := v.ValidateDate(startDate); err != nil {
		return err
	}
	if err := v.ValidateDate(endDate); err != nil {
		return err
	}
	
	start, _ := time.Parse("2006-01-02", startDate)
	end, _ := time.Parse("2006-01-02", endDate)
	
	if start.After(end) {
		return ValidationError{
			Field:   "date_range",
			Value:   fmt.Sprintf("%s to %s", startDate, endDate),
			Message: "start date must be before or equal to end date",
		}
	}
	
	// Check if range is not too large (e.g., max 2 years)
	if end.Sub(start).Hours() > 24*365*2 {
		return ValidationError{
			Field:   "date_range",
			Value:   fmt.Sprintf("%s to %s", startDate, endDate),
			Message: "date range cannot exceed 2 years",
		}
	}
	
	return nil
}

// ValidateAmount checks if the amount is valid
func (v *Validator) ValidateAmount(amount float64) error {
	if amount < 0 {
		return ValidationError{Field: "amount", Value: amount, Message: "amount cannot be negative"}
	}
	if amount > 1000000000 { // 1 billion limit
		return ValidationError{Field: "amount", Value: amount, Message: "amount exceeds maximum limit"}
	}
	return nil
}

// ValidateQuantity checks if the quantity is valid for crypto orders
func (v *Validator) ValidateQuantity(quantity float64, symbol string) error {
	if quantity <= 0 {
		return ValidationError{Field: "quantity", Value: quantity, Message: "quantity must be positive"}
	}
	
	// Symbol-specific minimum quantities
	minQuantities := map[string]float64{
		"BTC":   0.000001,
		"ETH":   0.00001,
		"DOGE":  1,
		"LTC":   0.001,
		"BCH":   0.001,
		"ETC":   0.01,
		"BSV":   0.001,
		"ADA":   1,
		"XRP":   1,
		"SOL":   0.01,
		"MATIC": 1,
		"AVAX":  0.01,
		"DOT":   0.01,
		"LINK":  0.01,
		"UNI":   0.01,
		"ALGO":  1,
		"ATOM":  0.01,
		"XLM":   1,
		"COMP":  0.001,
		"AAVE":  0.001,
	}
	
	minQty, exists := minQuantities[symbol]
	if !exists {
		minQty = 0.01 // Default minimum
	}
	
	if quantity < minQty {
		return ValidationError{
			Field:   "quantity",
			Value:   quantity,
			Message: fmt.Sprintf("quantity below minimum %f for symbol %s", minQty, symbol),
		}
	}
	
	if quantity > 1000000 { // Maximum quantity limit
		return ValidationError{Field: "quantity", Value: quantity, Message: "quantity exceeds maximum limit"}
	}
	
	return nil
}

// ValidateUserID checks if the user ID is valid
func (v *Validator) ValidateUserID(userID string) error {
	if userID == "" {
		return ValidationError{Field: "user_id", Value: userID, Message: "user ID cannot be empty"}
	}
	if len(userID) > 255 {
		return ValidationError{Field: "user_id", Value: userID, Message: "user ID too long (max 255 characters)"}
	}
	return nil
}

// ValidateLimit checks if the limit parameter is valid
func (v *Validator) ValidateLimit(limit int, maxLimit int) error {
	if limit < 1 {
		return ValidationError{Field: "limit", Value: limit, Message: "limit must be at least 1"}
	}
	if limit > maxLimit {
		return ValidationError{
			Field:   "limit",
			Value:   limit,
			Message: fmt.Sprintf("limit exceeds maximum of %d", maxLimit),
		}
	}
	return nil
}