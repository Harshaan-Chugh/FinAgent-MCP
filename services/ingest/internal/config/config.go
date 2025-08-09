package config

import (
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	ServiceName       string
	Port              string
	DatabaseURL       string
	RedisURL          string
	PlaidClientID     string
	PlaidSecret       string
	PlaidEnvironment  string
	RobinhoodUsername string
	RobinhoodPassword string
	JaegerEndpoint    string
	EncryptionKey     string
}

func Load() (*Config, error) {
	// Load .env file if it exists
	_ = godotenv.Load()

	cfg := &Config{
		ServiceName:       getEnv("SERVICE_NAME", "finagent-ingest"),
		Port:              getEnv("PORT", "8081"),
		DatabaseURL:       getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/finagent?sslmode=disable"),
		RedisURL:          getEnv("REDIS_URL", "redis://localhost:6379"),
		PlaidClientID:     getEnv("PLAID_CLIENT_ID", ""),
		PlaidSecret:       getEnv("PLAID_SECRET", ""),
		PlaidEnvironment:  getEnv("PLAID_ENVIRONMENT", "sandbox"),
		RobinhoodUsername: getEnv("ROBINHOOD_USERNAME", ""),
		RobinhoodPassword: getEnv("ROBINHOOD_PASSWORD", ""),
		JaegerEndpoint:    getEnv("JAEGER_ENDPOINT", "http://localhost:14268/api/traces"),
		EncryptionKey:     getEnv("ENCRYPTION_KEY", "dev-key-32-chars-long-for-aes-256"),
	}

	return cfg, nil
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}