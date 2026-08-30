package ar.edu.itba.cloud.queue.controller.dto;

import ar.edu.itba.cloud.queue.service.command.LoginCommand;
import jakarta.validation.constraints.NotBlank;

public record LoginRequest(@NotBlank String email, @NotBlank String password) {

    public LoginRequest {
        email = RequestText.trimToNull(email);
    }

    public LoginCommand toCommand() {
        return new LoginCommand(email, password);
    }
}
