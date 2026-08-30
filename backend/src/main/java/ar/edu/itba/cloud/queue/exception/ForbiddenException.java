package ar.edu.itba.cloud.queue.exception;

import org.springframework.http.HttpStatus;

public class ForbiddenException extends ApiException {

    public ForbiddenException(String code, String message) {
        super(HttpStatus.FORBIDDEN, code, message);
    }

    public static ForbiddenException notAMember() {
        return new ForbiddenException("NOT_A_MEMBER", "You do not have access to this establishment");
    }

    public static ForbiddenException ownerOnly() {
        return new ForbiddenException("OWNER_ONLY", "Only the establishment owner can perform this action");
    }
}
