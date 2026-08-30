package ar.edu.itba.cloud.queue.exception;

import org.springframework.http.HttpStatus;

/**
 * Base class for failures the API reports deliberately. Everything else is a 500.
 *
 * <p>{@code code} is a stable, machine-readable identifier the SPA can branch on without parsing
 * human-readable text.
 */
public abstract class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final String code;

    protected ApiException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }
}
