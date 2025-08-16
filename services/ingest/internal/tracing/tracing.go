package tracing

import (
	"context"
	"fmt"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/exporters/jaeger"
	"go.opentelemetry.io/otel/sdk/resource"
	tracesdk "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.4.0"
	"go.opentelemetry.io/otel/trace"
)

// InitTracer initializes the tracer with Jaeger exporter
func InitTracer(serviceName, jaegerEndpoint string) (*tracesdk.TracerProvider, error) {
	// Create Jaeger exporter
	exp, err := jaeger.New(jaeger.WithCollectorEndpoint(jaeger.WithEndpoint(jaegerEndpoint)))
	if err != nil {
		return nil, fmt.Errorf("failed to initialize Jaeger exporter: %w", err)
	}

	// Create tracer provider
	tp := tracesdk.NewTracerProvider(
		tracesdk.WithBatcher(exp),
		tracesdk.WithResource(resource.NewWithAttributes(
			semconv.SchemaURL,
			semconv.ServiceNameKey.String(serviceName),
			semconv.ServiceVersionKey.String("0.1.0"),
		)),
	)

	// Set global tracer provider
	otel.SetTracerProvider(tp)

	return tp, nil
}

// StartSpan starts a new span with the given name
func StartSpan(ctx context.Context, spanName string) (context.Context, trace.Span) {
	tracer := otel.Tracer("finagent-ingest")
	return tracer.Start(ctx, spanName)
}

// AddSpanEvent adds an event to the current span
func AddSpanEvent(span trace.Span, name string, attributes map[string]interface{}) {
	attrs := make([]trace.EventOption, 0, len(attributes))
	for _, value := range attributes {
		// Convert value to string for simplicity
		attrs = append(attrs, trace.WithAttributes(
			semconv.HTTPMethodKey.String(fmt.Sprintf("%v", value)),
		))
	}
	span.AddEvent(name, attrs...)
}

// SetSpanError sets error information on a span
func SetSpanError(span trace.Span, err error) {
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	}
}

// SetSpanSuccess marks a span as successful
func SetSpanSuccess(span trace.Span) {
	span.SetStatus(codes.Ok, "success")
}
