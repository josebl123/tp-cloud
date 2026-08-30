package ar.edu.itba.cloud.queue.controller.dto;

import ar.edu.itba.cloud.queue.service.command.JoinCommand;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * The "datos minimos" a customer gives when joining.
 *
 * <p>A contact channel is mandatory, not decorative: it is where the personal ticket link and the
 * turn alerts are delivered.
 */
public record JoinQueueRequest(
        @NotBlank @Size(max = 120) String name,
        @Email @Size(max = 255) String email,
        @Size(max = 40) String phone,
        @Min(1) Integer partySize) {

    public JoinQueueRequest {
        name = RequestText.trimToNull(name);
        email = RequestText.trimToNull(email);
        phone = RequestText.trimToNull(phone);
    }

    @AssertTrue(message = "An email address or a phone number is required")
    public boolean isContactProvided() {
        return (email != null && !email.isBlank()) || (phone != null && !phone.isBlank());
    }

    public JoinCommand toCommand() {
        return new JoinCommand(name, email, phone, partySize);
    }
}
