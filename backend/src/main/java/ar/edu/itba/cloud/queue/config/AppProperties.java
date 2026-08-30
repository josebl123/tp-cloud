package ar.edu.itba.cloud.queue.config;

import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/** Everything the application lets an operator tune, bound from the {@code q.*} configuration tree. */
@ConfigurationProperties(prefix = "q")
public record AppProperties(

        /** Base URL of the SPA. QR codes and ticket links are built on top of it. */
        @DefaultValue("http://localhost:3000") String publicBaseUrl,

        @DefaultValue("http://localhost:3000") List<String> corsAllowedOrigins,

        @DefaultValue Jwt jwt,
        @DefaultValue Estimation estimation,
        @DefaultValue Grace grace,
        @DefaultValue Sse sse,
        @DefaultValue Notifications notifications,
        @DefaultValue Seed seed) {

    public record Jwt(
            @DefaultValue("dev-only-secret-change-me-0123456789abcdef") String secret,
            @DefaultValue("q-api") String issuer,
            @DefaultValue("12h") Duration ttl) {
    }

    public record Estimation(
            /** How many recent completed services feed the moving average. */
            @DefaultValue("10") int serviceTimeSamples) {
    }

    public record Grace(
            /** How often the background job looks for expired grace periods. */
            @DefaultValue("10s") Duration sweepInterval) {
    }

    public record Sse(
            @DefaultValue("30m") Duration timeout,
            @DefaultValue("20s") Duration heartbeatInterval) {
    }

    public record Notifications(@DefaultValue Email email) {

        public record Email(
                @DefaultValue("false") boolean enabled,
                @DefaultValue("no-reply@q.local") String from) {
        }
    }

    public record Seed(@DefaultValue("false") boolean enabled) {
    }

    /** Link a customer follows to watch their own place in the line. */
    public String ticketUrl(Object ticketToken) {
        return "%s/t/%s".formatted(trimmedBaseUrl(), ticketToken);
    }

    /** Link a QR code encodes: the public landing page of a queue. */
    public String joinUrl(Object queueId) {
        return "%s/q/%s".formatted(trimmedBaseUrl(), queueId);
    }

    private String trimmedBaseUrl() {
        return publicBaseUrl.endsWith("/")
                ? publicBaseUrl.substring(0, publicBaseUrl.length() - 1)
                : publicBaseUrl;
    }
}
