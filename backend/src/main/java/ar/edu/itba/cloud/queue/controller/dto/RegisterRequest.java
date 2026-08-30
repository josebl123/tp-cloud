package ar.edu.itba.cloud.queue.controller.dto;

import ar.edu.itba.cloud.queue.service.command.RegisterCommand;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record RegisterRequest(
        @NotBlank @Email @Size(max = 255) String email,
        @NotBlank @Size(min = 8, max = 100) String password,
        @NotBlank @Size(max = 120) String displayName,
        @NotBlank @Size(max = 120) String establishmentName,
        @Size(max = 64) String timezone) {

    public RegisterRequest {
        email = RequestText.trimToNull(email);
        displayName = RequestText.trimToNull(displayName);
        establishmentName = RequestText.trimToNull(establishmentName);
        timezone = RequestText.trimToNull(timezone);
    }

    public RegisterCommand toCommand() {
        return new RegisterCommand(email, password, displayName, establishmentName, timezone);
    }
}
