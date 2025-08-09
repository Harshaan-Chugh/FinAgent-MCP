package utils

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

// APIResponse represents a standard API response structure
type APIResponse struct {
	Success   bool        `json:"success"`
	Data      interface{} `json:"data,omitempty"`
	Error     string      `json:"error,omitempty"`
	Meta      *Metadata   `json:"meta,omitempty"`
	Timestamp string      `json:"timestamp"`
}

// Metadata contains additional information about the response
type Metadata struct {
	Count       int         `json:"count,omitempty"`
	Source      string      `json:"source,omitempty"`
	Duration    string      `json:"duration,omitempty"`
	RequestID   string      `json:"request_id,omitempty"`
	Version     string      `json:"version,omitempty"`
	Pagination  *Pagination `json:"pagination,omitempty"`
}

// Pagination contains pagination information
type Pagination struct {
	Limit     int  `json:"limit"`
	Offset    int  `json:"offset"`
	Total     int  `json:"total,omitempty"`
	HasMore   bool `json:"has_more"`
	NextPage  *int `json:"next_page,omitempty"`
	PrevPage  *int `json:"prev_page,omitempty"`
}

// ErrorDetails provides detailed error information
type ErrorDetails struct {
	Code    string                 `json:"code"`
	Message string                 `json:"message"`
	Details map[string]interface{} `json:"details,omitempty"`
	Trace   string                 `json:"trace,omitempty"`
}

// ResponseWriter provides utilities for writing HTTP responses
type ResponseWriter struct {
	RequestID string
	StartTime time.Time
}

// NewResponseWriter creates a new response writer
func NewResponseWriter(requestID string) *ResponseWriter {
	return &ResponseWriter{
		RequestID: requestID,
		StartTime: time.Now(),
	}
}

// Success writes a successful response
func (rw *ResponseWriter) Success(w http.ResponseWriter, data interface{}, meta *Metadata) {
	response := APIResponse{
		Success:   true,
		Data:      data,
		Meta:      rw.enrichMeta(meta),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}
	
	rw.writeJSON(w, http.StatusOK, response)
}

// Error writes an error response
func (rw *ResponseWriter) Error(w http.ResponseWriter, statusCode int, message string) {
	response := APIResponse{
		Success:   false,
		Error:     message,
		Meta:      rw.enrichMeta(nil),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}
	
	rw.writeJSON(w, statusCode, response)
}

// ErrorWithDetails writes an error response with detailed information
func (rw *ResponseWriter) ErrorWithDetails(w http.ResponseWriter, statusCode int, details ErrorDetails) {
	response := APIResponse{
		Success:   false,
		Error:     details.Message,
		Data:      details,
		Meta:      rw.enrichMeta(nil),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}
	
	rw.writeJSON(w, statusCode, response)
}

// ValidationError writes a validation error response
func (rw *ResponseWriter) ValidationError(w http.ResponseWriter, validationErrors []ValidationError) {
	details := ErrorDetails{
		Code:    "VALIDATION_ERROR",
		Message: "Request validation failed",
		Details: map[string]interface{}{
			"validation_errors": validationErrors,
		},
	}
	
	rw.ErrorWithDetails(w, http.StatusBadRequest, details)
}

// NotFound writes a not found response
func (rw *ResponseWriter) NotFound(w http.ResponseWriter, resource string) {
	rw.Error(w, http.StatusNotFound, fmt.Sprintf("%s not found", resource))
}

// Unauthorized writes an unauthorized response
func (rw *ResponseWriter) Unauthorized(w http.ResponseWriter, message string) {
	if message == "" {
		message = "Unauthorized access"
	}
	rw.Error(w, http.StatusUnauthorized, message)
}

// Forbidden writes a forbidden response
func (rw *ResponseWriter) Forbidden(w http.ResponseWriter, message string) {
	if message == "" {
		message = "Access forbidden"
	}
	rw.Error(w, http.StatusForbidden, message)
}

// TooManyRequests writes a rate limit exceeded response
func (rw *ResponseWriter) TooManyRequests(w http.ResponseWriter, retryAfter int) {
	if retryAfter > 0 {
		w.Header().Set("Retry-After", fmt.Sprintf("%d", retryAfter))
	}
	rw.Error(w, http.StatusTooManyRequests, "Rate limit exceeded")
}

// InternalError writes an internal server error response
func (rw *ResponseWriter) InternalError(w http.ResponseWriter, err error) {
	log.Printf("Internal server error [%s]: %v", rw.RequestID, err)
	rw.Error(w, http.StatusInternalServerError, "Internal server error")
}

// Paginated writes a paginated response
func (rw *ResponseWriter) Paginated(w http.ResponseWriter, data interface{}, pagination *Pagination) {
	meta := &Metadata{
		Pagination: pagination,
	}
	
	if pagination != nil {
		// Calculate count if data is a slice
		switch v := data.(type) {
		case []interface{}:
			meta.Count = len(v)
		case []map[string]interface{}:
			meta.Count = len(v)
		}
	}
	
	rw.Success(w, data, meta)
}

// enrichMeta adds common metadata to the response
func (rw *ResponseWriter) enrichMeta(meta *Metadata) *Metadata {
	if meta == nil {
		meta = &Metadata{}
	}
	
	meta.RequestID = rw.RequestID
	meta.Duration = time.Since(rw.StartTime).String()
	meta.Version = "v1"
	
	return meta
}

// writeJSON writes a JSON response
func (rw *ResponseWriter) writeJSON(w http.ResponseWriter, statusCode int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Request-ID", rw.RequestID)
	w.WriteHeader(statusCode)
	
	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("Failed to encode JSON response [%s]: %v", rw.RequestID, err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
	}
}

// SetCacheHeaders sets appropriate cache headers
func SetCacheHeaders(w http.ResponseWriter, maxAge int) {
	if maxAge > 0 {
		w.Header().Set("Cache-Control", fmt.Sprintf("public, max-age=%d", maxAge))
	} else {
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("Expires", "0")
	}
}

// SetSecurityHeaders sets security-related headers
func SetSecurityHeaders(w http.ResponseWriter) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("X-XSS-Protection", "1; mode=block")
	w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
}