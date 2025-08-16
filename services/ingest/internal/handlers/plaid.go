package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/finagent/ingest/internal/models"
)

// PlaidWebhook handles incoming Plaid webhooks
func (h *Handlers) PlaidWebhook(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var webhook models.PlaidWebhook
	if err := json.NewDecoder(r.Body).Decode(&webhook); err != nil {
		h.respondError(w, http.StatusBadRequest, "Invalid webhook payload")
		return
	}

	// Log the webhook for debugging
	fmt.Printf("Received Plaid webhook: %+v\n", webhook)

	// Handle different webhook types
	switch webhook.WebhookType {
	case "TRANSACTIONS":
		if err := h.handleTransactionWebhook(ctx, webhook); err != nil {
			h.respondError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to handle transaction webhook: %v", err))
			return
		}
	case "ITEM":
		if err := h.handleItemWebhook(ctx, webhook); err != nil {
			h.respondError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to handle item webhook: %v", err))
			return
		}
	case "ASSETS":
		// Handle assets webhook if needed
	default:
		fmt.Printf("Unhandled webhook type: %s\n", webhook.WebhookType)
	}

	// Acknowledge webhook
	h.respondSuccess(w, map[string]interface{}{
		"acknowledged": true,
		"webhook_code": webhook.WebhookCode,
	})
}

func (h *Handlers) handleTransactionWebhook(ctx context.Context, webhook models.PlaidWebhook) error {
	// Create sync job
	jobID, err := h.createSyncJob(ctx, webhook.ItemID, "TRANSACTIONS")
	if err != nil {
		return fmt.Errorf("failed to create sync job: %w", err)
	}

	// Process sync job asynchronously
	go func() {
		if err := h.processSyncJob(context.Background(), jobID); err != nil {
			fmt.Printf("Failed to process sync job %s: %v\n", jobID, err)
		}
	}()

	return nil
}

func (h *Handlers) handleItemWebhook(ctx context.Context, webhook models.PlaidWebhook) error {
	// Handle item-related webhooks (errors, updates, etc.)
	switch webhook.WebhookCode {
	case "ERROR":
		// Update item status to error
		_, err := h.db.Pool.Exec(ctx,
			"UPDATE plaid_items SET status = 'error', updated_at = NOW() WHERE access_token_enc = $1",
			webhook.ItemID, // This would need to be properly mapped
		)
		return err
	case "PENDING_EXPIRATION":
		// Handle pending expiration
		fmt.Printf("Item %s is pending expiration\n", webhook.ItemID)
	}
	return nil
}

// ExchangePublicToken exchanges a Plaid public token for an access token
func (h *Handlers) ExchangePublicToken(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req struct {
		PublicToken string `json:"public_token"`
		UserID      string `json:"user_id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}

	if req.PublicToken == "" || req.UserID == "" {
		h.respondError(w, http.StatusBadRequest, "public_token and user_id are required")
		return
	}

	// Exchange public token for access token via Plaid
	accessToken, itemID, err := h.plaidClient.ExchangePublicToken(req.PublicToken)
	if err != nil {
		h.respondError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to exchange token: %v", err))
		return
	}

	// Encrypt access token
	encryptedToken, err := h.plaidClient.EncryptToken(accessToken)
	if err != nil {
		h.respondError(w, http.StatusInternalServerError, "Failed to encrypt token")
		return
	}

	// Get institution info
	institution, err := h.plaidClient.GetInstitution(itemID)
	if err != nil {
		fmt.Printf("Failed to get institution info: %v\n", err)
		// Continue without institution info
	}

	// Store Plaid item in database
	query := `
		INSERT INTO plaid_items (user_id, access_token_enc, institution_id, institution_name, status)
		VALUES ($1, $2, $3, $4, 'active')
		RETURNING id
	`

	var plaidItemID string
	err = h.db.Pool.QueryRow(ctx, query, req.UserID, encryptedToken,
		getStringValue(institution, "institution_id"),
		getStringValue(institution, "name")).Scan(&plaidItemID)
	if err != nil {
		h.respondError(w, http.StatusInternalServerError, "Failed to store Plaid item")
		return
	}

	// Trigger initial sync
	go func() {
		if err := h.syncPlaidData(context.Background(), req.UserID, plaidItemID, accessToken); err != nil {
			fmt.Printf("Failed to sync initial Plaid data: %v\n", err)
		}
	}()

	h.respondSuccess(w, map[string]interface{}{
		"item_id":     plaidItemID,
		"institution": institution,
		"message":     "Successfully linked account, syncing data...",
	})
}

// CreateLinkToken creates a Plaid Link token
func (h *Handlers) CreateLinkToken(w http.ResponseWriter, r *http.Request) {
	var req struct {
		UserID string `json:"user_id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}

	if req.UserID == "" {
		h.respondError(w, http.StatusBadRequest, "user_id is required")
		return
	}

	linkToken, expiration, err := h.plaidClient.CreateLinkToken(req.UserID)
	if err != nil {
		h.respondError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to create link token: %v", err))
		return
	}

	h.respondSuccess(w, map[string]interface{}{
		"link_token": linkToken,
		"expiration": expiration,
	})
}

// ManualSync triggers a manual sync for a specific Plaid item
func (h *Handlers) ManualSync(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req struct {
		UserID      string `json:"user_id"`
		PlaidItemID string `json:"plaid_item_id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}

	if req.UserID == "" || req.PlaidItemID == "" {
		h.respondError(w, http.StatusBadRequest, "user_id and plaid_item_id are required")
		return
	}

	// Get encrypted access token
	var encryptedToken []byte
	err := h.db.Pool.QueryRow(ctx,
		"SELECT access_token_enc FROM plaid_items WHERE id = $1 AND user_id = $2",
		req.PlaidItemID, req.UserID).Scan(&encryptedToken)
	if err != nil {
		h.respondError(w, http.StatusNotFound, "Plaid item not found")
		return
	}

	// Decrypt access token
	accessToken, err := h.plaidClient.DecryptToken(encryptedToken)
	if err != nil {
		h.respondError(w, http.StatusInternalServerError, "Failed to decrypt token")
		return
	}

	// Create sync job
	jobID, err := h.createSyncJob(ctx, req.PlaidItemID, "MANUAL_SYNC")
	if err != nil {
		h.respondError(w, http.StatusInternalServerError, "Failed to create sync job")
		return
	}

	// Process sync job asynchronously
	go func() {
		if err := h.syncPlaidData(context.Background(), req.UserID, req.PlaidItemID, accessToken); err != nil {
			fmt.Printf("Failed to sync Plaid data: %v\n", err)
			// Update job status to failed
			h.updateSyncJob(context.Background(), jobID, "failed", err.Error())
		} else {
			// Update job status to completed
			h.updateSyncJob(context.Background(), jobID, "completed", "")
		}
	}()

	h.respondSuccess(w, map[string]interface{}{
		"job_id":  jobID,
		"message": "Sync job started",
	})
}

func (h *Handlers) createSyncJob(ctx context.Context, itemID, jobType string) (string, error) {
	var jobID string
	err := h.db.Pool.QueryRow(ctx,
		`INSERT INTO sync_jobs (plaid_item_id, job_type, status, started_at)
		 VALUES ($1, $2, 'running', NOW())
		 RETURNING id`,
		itemID, jobType).Scan(&jobID)
	return jobID, err
}

func (h *Handlers) updateSyncJob(ctx context.Context, jobID, status, errorMsg string) error {
	_, err := h.db.Pool.Exec(ctx,
		`UPDATE sync_jobs 
		 SET status = $2, completed_at = NOW(), error_message = $3
		 WHERE id = $1`,
		jobID, status, errorMsg)
	return err
}

func (h *Handlers) processSyncJob(ctx context.Context, jobID string) error {
	// This would implement the actual sync logic
	// For now, just update the job status
	time.Sleep(2 * time.Second) // Simulate processing time
	return h.updateSyncJob(ctx, jobID, "completed", "")
}

func (h *Handlers) syncPlaidData(ctx context.Context, userID, plaidItemID, accessToken string) error {
	// Sync accounts
	if err := h.syncAccounts(ctx, userID, plaidItemID, accessToken); err != nil {
		return fmt.Errorf("failed to sync accounts: %w", err)
	}

	// Sync transactions
	if err := h.syncTransactions(ctx, userID, accessToken); err != nil {
		return fmt.Errorf("failed to sync transactions: %w", err)
	}

	// Sync investments if available
	if err := h.syncInvestments(ctx, userID, accessToken); err != nil {
		fmt.Printf("Failed to sync investments (may not be available): %v\n", err)
		// Don't fail the entire sync for investments
	}

	return nil
}

func (h *Handlers) syncAccounts(ctx context.Context, userID, plaidItemID, accessToken string) error {
	accounts, err := h.plaidClient.GetAccounts(accessToken)
	if err != nil {
		return err
	}

	for _, account := range accounts {
		// Upsert account
		_, err := h.db.Pool.Exec(ctx, `
			INSERT INTO accounts (id, user_id, plaid_item_id, name, mask, official_name, 
								type, subtype, currency, balance_current, balance_available, 
								balance_limit, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
			ON CONFLICT (id) 
			DO UPDATE SET 
				name = EXCLUDED.name,
				balance_current = EXCLUDED.balance_current,
				balance_available = EXCLUDED.balance_available,
				balance_limit = EXCLUDED.balance_limit,
				updated_at = NOW()
		`, account.ID, userID, plaidItemID, account.Name, account.Mask,
			account.OfficialName, account.Type, account.Subtype, getIsoCurrency(account.Balances),
			account.Balances.Current, account.Balances.Available, account.Balances.Limit)

		if err != nil {
			return fmt.Errorf("failed to upsert account %s: %w", account.ID, err)
		}
	}

	return nil
}

func (h *Handlers) syncTransactions(ctx context.Context, userID, accessToken string) error {
	// This would implement transaction syncing with cursor-based pagination
	// For now, just a placeholder
	fmt.Printf("Syncing transactions for user %s\n", userID)
	return nil
}

func (h *Handlers) syncInvestments(ctx context.Context, userID, accessToken string) error {
	// This would implement investment syncing
	// For now, just a placeholder
	fmt.Printf("Syncing investments for user %s\n", userID)
	return nil
}

func getStringValue(data interface{}, key string) string {
	if data == nil {
		return ""
	}
	if m, ok := data.(map[string]interface{}); ok {
		if v, ok := m[key].(string); ok {
			return v
		}
	}
	return ""
}

// getIsoCurrency extracts currency from PlaidBalance
func getIsoCurrency(balance models.PlaidBalance) string {
	if balance.IsoCurrencyCode != nil {
		return *balance.IsoCurrencyCode
	}
	if balance.UnofficialCurrencyCode != nil {
		return *balance.UnofficialCurrencyCode
	}
	return "USD" // default
}
