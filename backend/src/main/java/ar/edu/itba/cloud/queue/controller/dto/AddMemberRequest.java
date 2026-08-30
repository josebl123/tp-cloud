package ar.edu.itba.cloud.queue.controller.dto;

import ar.edu.itba.cloud.queue.persistence.entity.MembershipRole;
import ar.edu.itba.cloud.queue.service.command.AddMemberCommand;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** {@code password} and {@code displayName} are only needed when the email has no account yet. */
public record AddMemberRequest(
        @NotBlank @Email @Size(max = 255) String email,
        @Size(min = 8, max = 100) String password,
        @Size(max = 120) String displayName,
        MembershipRole role) {

    public AddMemberRequest {
        email = RequestText.trimToNull(email);
        displayName = RequestText.trimToNull(displayName);
    }

    public AddMemberCommand toCommand() {
        return new AddMemberCommand(email, password, displayName, role);
    }
}
