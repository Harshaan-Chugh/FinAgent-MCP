package plaid

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"fmt"
	"io"
	"time"

	"github.com/finagent/ingest/internal/models"
)

// Client wraps Plaid API interactions
type Client struct {
	clientID    string
	secret      string
	environment string
	encryptionKey []byte
}

// NewClient creates a new Plaid client
func NewClient(clientID, secret, environment string) *Client {
	return &Client{
		clientID:    clientID,
		secret:      secret,
		environment: environment,
		encryptionKey: []byte("dev-key-32-chars-long-for-aes-256"), // This should come from config
	}
}

// ExchangePublicToken exchanges a public token for an access token
func (c *Client) ExchangePublicToken(publicToken string) (accessToken, itemID string, err error) {
	// This is a mock implementation
	// In a real implementation, you would call the Plaid API
	
	if publicToken == "" {
		return "", "", fmt.Errorf("public token is required")
	}
	
	// Generate mock values for development
	accessToken = fmt.Sprintf("access-sandbox-%d", time.Now().Unix())
	itemID = fmt.Sprintf("item-%d", time.Now().Unix())
	
	return accessToken, itemID, nil
}

// CreateLinkToken creates a Link token for Plaid Link
func (c *Client) CreateLinkToken(userID string) (linkToken string, expiration time.Time, err error) {
	if userID == "" {
		return "", time.Time{}, fmt.Errorf("user ID is required")
	}
	
	// Mock implementation
	linkToken = fmt.Sprintf("link-sandbox-%s-%d", userID, time.Now().Unix())
	expiration = time.Now().Add(4 * time.Hour)
	
	return linkToken, expiration, nil
}

// GetInstitution gets institution information
func (c *Client) GetInstitution(itemID string) (map[string]interface{}, error) {
	// Mock institution data
	institution := map[string]interface{}{
		"institution_id": "ins_109508",
		"name":          "First Platypus Bank",
		"products":      []string{"assets", "auth", "balance", "transactions", "investments"},
		"country_codes": []string{"US"},
	}
	
	return institution, nil
}

// GetAccounts retrieves accounts for an access token
func (c *Client) GetAccounts(accessToken string) ([]models.PlaidAccount, error) {
	if accessToken == "" {
		return nil, fmt.Errorf("access token is required")
	}
	
	// Mock account data for development
	accounts := []models.PlaidAccount{
		{
			ID:           "acc_1_checking",
			Name:         "Plaid Checking",
			Mask:         stringPtr("0000"),
			OfficialName: stringPtr("Plaid Gold Standard 0% Interest Checking"),
			Type:         "depository",
			Subtype:      stringPtr("checking"),
			Balances: models.PlaidBalance{
				Current:           float64Ptr(1250.55),
				Available:         float64Ptr(1200.55),
				IsoCurrencyCode:   stringPtr("USD"),
			},
		},
		{
			ID:           "acc_2_savings",
			Name:         "Plaid Savings",
			Mask:         stringPtr("1111"),
			OfficialName: stringPtr("Plaid Silver Standard 0.1% Interest Savings"),
			Type:         "depository",
			Subtype:      stringPtr("savings"),
			Balances: models.PlaidBalance{
				Current:           float64Ptr(5025.10),
				Available:         float64Ptr(5025.10),
				IsoCurrencyCode:   stringPtr("USD"),
			},
		},
		{
			ID:           "acc_3_investment",
			Name:         "Plaid Investment",
			Mask:         stringPtr("2222"),
			OfficialName: stringPtr("Plaid Diamond 12-Month CD"),
			Type:         "investment",
			Subtype:      stringPtr("cd"),
			Balances: models.PlaidBalance{
				Current:           float64Ptr(15750.25),
				IsoCurrencyCode:   stringPtr("USD"),
			},
		},
	}
	
	return accounts, nil
}

// GetTransactions retrieves transactions for an access token
func (c *Client) GetTransactions(accessToken string, startDate, endDate time.Time, cursor string) ([]models.PlaidTransaction, string, error) {
	if accessToken == "" {
		return nil, "", fmt.Errorf("access token is required")
	}
	
	// Mock transaction data
	transactions := []models.PlaidTransaction{
		{
			ID:           "txn_1_coffee",
			AccountID:    "acc_1_checking",
			Date:         time.Now().AddDate(0, 0, -1).Format("2006-01-02"),
			Amount:       4.50,
			MerchantName: stringPtr("Starbucks"),
			Name:         "Starbucks Store #1234",
			Category:     []string{"Food and Drink", "Coffee"},
			Pending:      false,
		},
		{
			ID:           "txn_2_grocery",
			AccountID:    "acc_1_checking",
			Date:         time.Now().AddDate(0, 0, -2).Format("2006-01-02"),
			Amount:       125.67,
			MerchantName: stringPtr("Whole Foods Market"),
			Name:         "Whole Foods Market #456",
			Category:     []string{"Food and Drink", "Groceries"},
			Pending:      false,
		},
		{
			ID:           "txn_3_payroll",
			AccountID:    "acc_1_checking",
			Date:         time.Now().AddDate(0, 0, -3).Format("2006-01-02"),
			Amount:       -2500.00, // Negative for income in Plaid
			MerchantName: stringPtr("Acme Corp"),
			Name:         "Acme Corp Payroll",
			Category:     []string{"Payroll", "Salary"},
			Pending:      false,
		},
	}
	
	nextCursor := fmt.Sprintf("cursor-%d", time.Now().Unix())
	
	return transactions, nextCursor, nil
}

// GetHoldings retrieves investment holdings
func (c *Client) GetHoldings(accessToken string) (interface{}, error) {
	if accessToken == "" {
		return nil, fmt.Errorf("access token is required")
	}
	
	// Mock holdings data
	holdings := map[string]interface{}{
		"accounts": []interface{}{
			map[string]interface{}{
				"account_id": "acc_3_investment",
				"holdings": []interface{}{
					map[string]interface{}{
						"account_id":         "acc_3_investment",
						"security_id":        "sec_AAPL",
						"institution_price":  150.25,
						"institution_value":  1502.50,
						"cost_basis":        1400.00,
						"quantity":          10.0,
						"iso_currency_code": "USD",
					},
					map[string]interface{}{
						"account_id":         "acc_3_investment",
						"security_id":        "sec_TSLA",
						"institution_price":  245.75,
						"institution_value":  1228.75,
						"cost_basis":        1100.00,
						"quantity":          5.0,
						"iso_currency_code": "USD",
					},
				},
			},
		},
		"securities": []interface{}{
			map[string]interface{}{
				"security_id": "sec_AAPL",
				"cusip":      "037833100",
				"symbol":     "AAPL",
				"name":       "Apple Inc.",
				"type":       "equity",
			},
			map[string]interface{}{
				"security_id": "sec_TSLA",
				"cusip":      "88160R101",
				"symbol":     "TSLA",
				"name":       "Tesla, Inc.",
				"type":       "equity",
			},
		},
	}
	
	return holdings, nil
}

// EncryptToken encrypts an access token
func (c *Client) EncryptToken(token string) ([]byte, error) {
	block, err := aes.NewCipher(c.encryptionKey)
	if err != nil {
		return nil, err
	}
	
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	
	nonce := make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	
	ciphertext := gcm.Seal(nonce, nonce, []byte(token), nil)
	return ciphertext, nil
}

// DecryptToken decrypts an access token
func (c *Client) DecryptToken(encryptedToken []byte) (string, error) {
	block, err := aes.NewCipher(c.encryptionKey)
	if err != nil {
		return "", err
	}
	
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	
	nonceSize := gcm.NonceSize()
	if len(encryptedToken) < nonceSize {
		return "", fmt.Errorf("ciphertext too short")
	}
	
	nonce, ciphertext := encryptedToken[:nonceSize], encryptedToken[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}
	
	return string(plaintext), nil
}

// Helper functions
func stringPtr(s string) *string {
	return &s
}

func float64Ptr(f float64) *float64 {
	return &f
}