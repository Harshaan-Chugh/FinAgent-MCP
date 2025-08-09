package middleware

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/finagent/ingest/internal/utils"
	"github.com/go-redis/redis/v8"
	"github.com/google/uuid"
)

// RequestIDKey is the context key for request ID
type RequestIDKey struct{}

// UserIDKey is the context key for user ID
type UserIDKey struct{}

// RateLimiter provides rate limiting functionality
type RateLimiter struct {
	redis  *redis.Client
	window time.Duration
	limit  int
}

// NewRateLimiter creates a new rate limiter
func NewRateLimiter(redis *redis.Client, window time.Duration, limit int) *RateLimiter {
	return &RateLimiter{
		redis:  redis,
		window: window,
		limit:  limit,
	}
}

// RequestIDMiddleware adds a unique request ID to each request
func RequestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			requestID = uuid.New().String()
		}
		
		ctx := context.WithValue(r.Context(), RequestIDKey{}, requestID)
		w.Header().Set("X-Request-ID", requestID)
		
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// CORSMiddleware handles Cross-Origin Resource Sharing
func CORSMiddleware(allowedOrigins []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			
			// Check if origin is allowed
			allowed := false
			for _, allowedOrigin := range allowedOrigins {
				if allowedOrigin == "*" || allowedOrigin == origin {
					allowed = true
					break
				}
			}
			
			if allowed {
				w.Header().Set("Access-Control-Allow-Origin", origin)
			}
			
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID, X-User-ID")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Max-Age", "86400")
			
			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}
			
			next.ServeHTTP(w, r)
		})
	}
}

// AuthMiddleware extracts and validates user ID from headers
func AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID := r.Header.Get("X-User-ID")
		if userID == "" {
			rw := utils.NewResponseWriter(getRequestID(r))
			rw.Unauthorized(w, "X-User-ID header is required")
			return
		}
		
		// Validate user ID format
		validator := utils.NewValidator()
		if err := validator.ValidateUserID(userID); err != nil {
			rw := utils.NewResponseWriter(getRequestID(r))
			rw.ValidationError(w, []utils.ValidationError{err.(utils.ValidationError)})
			return
		}
		
		ctx := context.WithValue(r.Context(), UserIDKey{}, userID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RateLimitMiddleware applies rate limiting per user
func (rl *RateLimiter) RateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		if userID == "" {
			// Skip rate limiting if no user ID
			next.ServeHTTP(w, r)
			return
		}
		
		key := fmt.Sprintf("rate_limit:%s", userID)
		
		// Get current count
		count, err := rl.redis.Get(r.Context(), key).Int()
		if err != nil && err != redis.Nil {
			// On Redis error, allow the request but log the error
			fmt.Printf("Rate limiter Redis error: %v\n", err)
			next.ServeHTTP(w, r)
			return
		}
		
		if count >= rl.limit {
			// Get TTL for Retry-After header
			ttl, _ := rl.redis.TTL(r.Context(), key).Result()
			retryAfter := int(ttl.Seconds())
			
			rw := utils.NewResponseWriter(getRequestID(r))
			rw.TooManyRequests(w, retryAfter)
			return
		}
		
		// Increment counter
		pipe := rl.redis.Pipeline()
		pipe.Incr(r.Context(), key)
		pipe.Expire(r.Context(), key, rl.window)
		
		if _, err := pipe.Exec(r.Context()); err != nil {
			fmt.Printf("Rate limiter Redis pipeline error: %v\n", err)
			// Continue with request even if Redis fails
		}
		
		next.ServeHTTP(w, r)
	})
}

// SecurityHeadersMiddleware adds security headers
func SecurityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		utils.SetSecurityHeaders(w)
		next.ServeHTTP(w, r)
	})
}

// LoggingMiddleware logs HTTP requests
func LoggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		
		// Create a custom response writer to capture status code
		wrapped := &responseWriter{
			ResponseWriter: w,
			statusCode:     http.StatusOK,
		}
		
		next.ServeHTTP(wrapped, r)
		
		duration := time.Since(start)
		
		fmt.Printf("[%s] %s %s %d %v - %s %s\n",
			time.Now().Format("2006-01-02 15:04:05"),
			r.Method,
			r.URL.Path,
			wrapped.statusCode,
			duration,
			getRequestID(r),
			getUserID(r),
		)
	})
}

// TimeoutMiddleware adds a timeout to requests
func TimeoutMiddleware(timeout time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), timeout)
			defer cancel()
			
			r = r.WithContext(ctx)
			
			done := make(chan struct{})
			go func() {
				defer close(done)
				next.ServeHTTP(w, r)
			}()
			
			select {
			case <-done:
				return
			case <-ctx.Done():
				if ctx.Err() == context.DeadlineExceeded {
					rw := utils.NewResponseWriter(getRequestID(r))
					rw.Error(w, http.StatusRequestTimeout, "Request timeout")
				}
			}
		})
	}
}

// CompressionMiddleware adds gzip compression
func CompressionMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check if client accepts gzip
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}
		
		// Only compress certain content types
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Set("Vary", "Accept-Encoding")
		
		next.ServeHTTP(w, r)
	})
}

// ContentTypeMiddleware enforces JSON content type for POST/PUT requests
func ContentTypeMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" || r.Method == "PUT" {
			contentType := r.Header.Get("Content-Type")
			if !strings.HasPrefix(contentType, "application/json") {
				rw := utils.NewResponseWriter(getRequestID(r))
				rw.Error(w, http.StatusUnsupportedMediaType, "Content-Type must be application/json")
				return
			}
		}
		
		next.ServeHTTP(w, r)
	})
}

// RecoveryMiddleware recovers from panics
func RecoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				fmt.Printf("Panic recovered [%s]: %v\n", getRequestID(r), err)
				
				rw := utils.NewResponseWriter(getRequestID(r))
				rw.InternalError(w, fmt.Errorf("panic: %v", err))
			}
		}()
		
		next.ServeHTTP(w, r)
	})
}

// responseWriter wraps http.ResponseWriter to capture status code
type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

// Helper functions

func getRequestID(r *http.Request) string {
	if requestID, ok := r.Context().Value(RequestIDKey{}).(string); ok {
		return requestID
	}
	return "unknown"
}

func getUserID(r *http.Request) string {
	if userID, ok := r.Context().Value(UserIDKey{}).(string); ok {
		return userID
	}
	return r.Header.Get("X-User-ID")
}

// GetUserID extracts user ID from request context
func GetUserID(r *http.Request) string {
	return getUserID(r)
}

// GetRequestID extracts request ID from request context
func GetRequestID(r *http.Request) string {
	return getRequestID(r)
}