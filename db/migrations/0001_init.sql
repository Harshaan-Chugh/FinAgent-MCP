-- FinAgent MCP Database Schema
-- Created: 2025-01-09

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users table
CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_id text UNIQUE NOT NULL,
    email text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Plaid items (represents a bank connection)
CREATE TABLE plaid_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    access_token_enc bytea NOT NULL,
    institution_id text,
    institution_name text,
    status text NOT NULL DEFAULT 'active',
    cursor text,
    webhook_url text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    last_sync_at timestamptz
);

-- Accounts (bank accounts from Plaid)
CREATE TABLE accounts (
    id text PRIMARY KEY, -- plaid account_id
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    plaid_item_id uuid REFERENCES plaid_items(id) ON DELETE CASCADE,
    name text NOT NULL,
    mask text,
    official_name text,
    type text NOT NULL,
    subtype text,
    currency text NOT NULL DEFAULT 'USD',
    balance_available numeric,
    balance_current numeric,
    balance_limit numeric,
    is_closed boolean DEFAULT false,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Transactions
CREATE TABLE transactions (
    id text PRIMARY KEY, -- plaid transaction_id
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    account_id text REFERENCES accounts(id) ON DELETE CASCADE,
    date date NOT NULL,
    amount numeric NOT NULL,
    merchant_name text,
    category text[],
    category_detailed text[],
    description text,
    location jsonb,
    payment_meta jsonb,
    account_owner text,
    is_pending boolean DEFAULT false,
    raw jsonb NOT NULL,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Securities (stocks, bonds, etc.)
CREATE TABLE securities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    security_id text UNIQUE NOT NULL, -- plaid security_id
    symbol text,
    name text NOT NULL,
    cusip text,
    isin text,
    sedol text,
    currency text NOT NULL DEFAULT 'USD',
    market_identifier_code text,
    type text,
    raw jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Holdings (investment positions)
CREATE TABLE holdings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    account_id text REFERENCES accounts(id) ON DELETE CASCADE,
    security_id uuid REFERENCES securities(id) ON DELETE CASCADE,
    quantity numeric NOT NULL,
    institution_price numeric,
    institution_price_as_of date,
    institution_value numeric,
    cost_basis numeric,
    unofficial_currency_code text,
    raw jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    last_refresh timestamptz DEFAULT now()
);

-- Investment transactions
CREATE TABLE investment_transactions (
    id text PRIMARY KEY, -- plaid investment_transaction_id
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    account_id text REFERENCES accounts(id) ON DELETE CASCADE,
    security_id uuid REFERENCES securities(id),
    date date NOT NULL,
    name text NOT NULL,
    quantity numeric,
    amount numeric NOT NULL,
    price numeric,
    fees numeric,
    type text NOT NULL,
    subtype text,
    iso_currency_code text,
    unofficial_currency_code text,
    raw jsonb NOT NULL,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Crypto positions (Robinhood)
CREATE TABLE crypto_positions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    symbol text NOT NULL,
    name text,
    quantity numeric NOT NULL,
    average_price numeric,
    market_value numeric,
    cost_basis numeric,
    unrealized_pnl numeric,
    currency text NOT NULL DEFAULT 'USD',
    last_price numeric,
    price_change_24h numeric,
    price_change_percent_24h numeric,
    raw jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    last_refresh timestamptz DEFAULT now()
);

-- Crypto orders (Robinhood)
CREATE TABLE crypto_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    symbol text NOT NULL,
    side text NOT NULL CHECK (side IN ('buy', 'sell')),
    quantity numeric NOT NULL,
    order_type text NOT NULL DEFAULT 'market',
    price numeric,
    status text NOT NULL DEFAULT 'pending',
    dry_run boolean DEFAULT true,
    robinhood_order_id text,
    filled_quantity numeric DEFAULT 0,
    average_fill_price numeric,
    fees numeric,
    error_message text,
    placed_at timestamptz DEFAULT now(),
    filled_at timestamptz,
    cancelled_at timestamptz,
    raw jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Sync jobs for tracking data ingestion
CREATE TABLE sync_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    plaid_item_id uuid REFERENCES plaid_items(id) ON DELETE CASCADE,
    job_type text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    started_at timestamptz,
    completed_at timestamptz,
    error_message text,
    cursor_before text,
    cursor_after text,
    records_processed integer DEFAULT 0,
    created_at timestamptz DEFAULT now()
);

-- Rate limiting and idempotency (stored in Redis primarily, but fallback table)
CREATE TABLE rate_limits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    endpoint text NOT NULL,
    requests_count integer DEFAULT 1,
    window_start timestamptz NOT NULL,
    created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX idx_transactions_user_date ON transactions(user_id, date DESC);
CREATE INDEX idx_transactions_account_date ON transactions(account_id, date DESC);
CREATE INDEX idx_transactions_merchant ON transactions(merchant_name);
CREATE INDEX idx_transactions_category ON transactions USING GIN (category);

CREATE INDEX idx_accounts_user_id ON accounts(user_id);
CREATE INDEX idx_accounts_plaid_item ON accounts(plaid_item_id);

CREATE INDEX idx_holdings_user_id ON holdings(user_id);
CREATE INDEX idx_holdings_account_id ON holdings(account_id);
CREATE INDEX idx_holdings_security_id ON holdings(security_id);

CREATE INDEX idx_investment_transactions_user_date ON investment_transactions(user_id, date DESC);
CREATE INDEX idx_investment_transactions_account_date ON investment_transactions(account_id, date DESC);

CREATE INDEX idx_crypto_positions_user_id ON crypto_positions(user_id);
CREATE INDEX idx_crypto_orders_user_id ON crypto_orders(user_id);
CREATE INDEX idx_crypto_orders_status ON crypto_orders(status);

CREATE INDEX idx_sync_jobs_user_id ON sync_jobs(user_id);
CREATE INDEX idx_sync_jobs_plaid_item ON sync_jobs(plaid_item_id);
CREATE INDEX idx_sync_jobs_status ON sync_jobs(status);

CREATE INDEX idx_plaid_items_user_id ON plaid_items(user_id);

-- Create a function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_plaid_items_updated_at BEFORE UPDATE ON plaid_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_securities_updated_at BEFORE UPDATE ON securities
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_holdings_updated_at BEFORE UPDATE ON holdings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_investment_transactions_updated_at BEFORE UPDATE ON investment_transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_crypto_positions_updated_at BEFORE UPDATE ON crypto_positions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_crypto_orders_updated_at BEFORE UPDATE ON crypto_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert sample data for development
INSERT INTO users (auth_id, email) VALUES ('dev-user-1', 'dev@example.com');

-- Sample accounts for development
DO $$
DECLARE
    user_uuid uuid;
    item_uuid uuid;
BEGIN
    SELECT id INTO user_uuid FROM users WHERE auth_id = 'dev-user-1';
    
    INSERT INTO plaid_items (user_id, access_token_enc, institution_id, institution_name, status)
    VALUES (user_uuid, decode('sample_encrypted_token', 'base64'), 'ins_1', 'Chase Bank', 'active')
    RETURNING id INTO item_uuid;
    
    INSERT INTO accounts (id, user_id, plaid_item_id, name, mask, type, subtype, currency, balance_current)
    VALUES 
        ('acc_dev_checking', user_uuid, item_uuid, 'Chase Checking', '0000', 'depository', 'checking', 'USD', 1250.55),
        ('acc_dev_savings', user_uuid, item_uuid, 'Chase Savings', '1111', 'depository', 'savings', 'USD', 5025.10),
        ('acc_dev_investment', user_uuid, item_uuid, 'Chase Investment', '2222', 'investment', 'brokerage', 'USD', 15750.25);
        
    -- Sample transactions
    INSERT INTO transactions (id, user_id, account_id, date, amount, merchant_name, category, description, raw)
    VALUES 
        ('txn_1', user_uuid, 'acc_dev_checking', CURRENT_DATE - INTERVAL '1 day', -45.50, 'Starbucks', ARRAY['Food and Drink', 'Coffee'], 'Coffee purchase', '{}'),
        ('txn_2', user_uuid, 'acc_dev_checking', CURRENT_DATE - INTERVAL '2 days', -125.00, 'Whole Foods', ARRAY['Food and Drink', 'Groceries'], 'Grocery shopping', '{}'),
        ('txn_3', user_uuid, 'acc_dev_checking', CURRENT_DATE - INTERVAL '3 days', 2500.00, 'Payroll Corp', ARRAY['Payroll'], 'Salary deposit', '{}');
        
    -- Sample crypto positions
    INSERT INTO crypto_positions (user_id, symbol, name, quantity, average_price, market_value, cost_basis)
    VALUES 
        (user_uuid, 'BTC', 'Bitcoin', 0.05, 45000.00, 2250.00, 2000.00),
        (user_uuid, 'ETH', 'Ethereum', 2.5, 3200.00, 8000.00, 7500.00),
        (user_uuid, 'DOGE', 'Dogecoin', 1000.0, 0.08, 80.00, 100.00);
END $$;