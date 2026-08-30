package ar.edu.itba.cloud.queue.controller.dto;

import ar.edu.itba.cloud.queue.service.command.EstablishmentCommand;
import jakarta.validation.constraints.Size;

public record EstablishmentRequest(
        @Size(max = 120) String name,
        @Size(max = 64) String timezone) {

    public EstablishmentRequest {
        name = RequestText.trimToNull(name);
        timezone = RequestText.trimToNull(timezone);
    }

    public EstablishmentCommand toCommand() {
        return new EstablishmentCommand(name, timezone);
    }
}
