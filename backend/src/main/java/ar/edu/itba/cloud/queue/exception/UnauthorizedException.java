package ar.edu.itba.cloud.queue.exception;

import org.springframework.http.HttpStatus;

public class UnauthorizedException extends ApiException {

    public UnauthorizedException(String code, String message) {
        super(HttpStatus.UNAUTHORIZED, code, message);
    }

    public static UnauthorizedException badCredentials() {
        return new UnauthorizedException("BAD_CREDENTIALS", "Email or password is incorrect");
    }
}
