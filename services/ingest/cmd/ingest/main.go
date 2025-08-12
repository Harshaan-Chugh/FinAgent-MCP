package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/finagent/ingest/internal/config"
	"github.com/finagent/ingest/internal/database"
	"github.com/finagent/ingest/internal/handlers"
	"github.com/finagent/ingest/internal/plaid"
	"github.com/finagent/ingest/internal/robinhood"
	"github.com/finagent/ingest/internal/tracing"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

func main() {
	ctx := context.Background()

	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Initialize tracing
	tracerProvider, err := tracing.InitTracer(cfg.ServiceName, cfg.JaegerEndpoint)
	if err != nil {
		log.Printf("Failed to initialize tracing: %v", err)
	}
	if tracerProvider != nil {
    	defer tracerProvider.Shutdown(ctx)
	}

	// Initialize database
	db, err := database.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	// Initialize Redis
	redisClient := database.ConnectRedis(cfg.RedisURL)
	defer redisClient.Close()

	// Initialize Plaid client
	plaidClient := plaid.NewClient(cfg.PlaidClientID, cfg.PlaidSecret, cfg.PlaidEnvironment)

	// Initialize Robinhood client
	rhClient := robinhood.NewClient(cfg.RobinhoodUsername, cfg.RobinhoodPassword)

	// Initialize handlers
	h := handlers.New(db, redisClient, plaidClient, rhClient)

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
	r.Get("/healthz", h.HealthCheck)

	// Plaid endpoints
	r.Route("/plaid", func(r chi.Router) {
		r.Post("/webhook", h.PlaidWebhook)
		r.Post("/exchange-public", h.ExchangePublicToken)
		r.Post("/sync", h.ManualSync)
		r.Post("/link-token", h.CreateLinkToken)
	})

	// Read endpoints for MCP server
	r.Route("/read", func(r chi.Router) {
		r.Get("/accounts", h.GetAccounts)
		r.Get("/transactions", h.GetTransactions)
		r.Get("/holdings", h.GetHoldings)
		r.Get("/investment-transactions", h.GetInvestmentTransactions)
	})

	// Robinhood endpoints
	r.Route("/rh", func(r chi.Router) {
		r.Get("/positions", h.GetCryptoPositions)
		r.Post("/orders", h.PlaceCryptoOrder)
	})

	// Metrics endpoint
	r.Get("/metrics", h.GetMetrics)

	// Start server
	server := &http.Server{
		Addr:    fmt.Sprintf(":%s", cfg.Port),
		Handler: r,
	}

	// Start server in a goroutine
	go func() {
		log.Printf("Go ingestion service running on port %s", cfg.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed to start: %v", err)
		}
	}()

	// Wait for interrupt signal to gracefully shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")

	// Create shutdown context with timeout
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Shutdown server
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("Server forced to shutdown: %v", err)
	}

	log.Println("Server exited")
}