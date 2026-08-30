package ar.edu.itba.cloud.queue.exception;

import org.springframework.http.HttpStatus;

/** A rule that cannot be expressed with bean-validation annotations alone. */
public class ValidationException extends ApiException {

    public ValidationException(String code, String message) {
        super(HttpStatus.BAD_REQUEST, code, message);
    }
}
