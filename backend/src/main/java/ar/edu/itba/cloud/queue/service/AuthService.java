package ar.edu.itba.cloud.queue.service;

import ar.edu.itba.cloud.queue.exception.ConflictException;
import ar.edu.itba.cloud.queue.exception.NotFoundException;
import ar.edu.itba.cloud.queue.exception.UnauthorizedException;
import ar.edu.itba.cloud.queue.exception.ValidationException;
import ar.edu.itba.cloud.queue.persistence.entity.Establishment;
import ar.edu.itba.cloud.queue.persistence.entity.Membership;
import ar.edu.itba.cloud.queue.persistence.entity.MembershipRole;
import ar.edu.itba.cloud.queue.persistence.entity.UserAccount;
import ar.edu.itba.cloud.queue.persistence.repository.EstablishmentRepository;
import ar.edu.itba.cloud.queue.persistence.repository.MembershipRepository;
import ar.edu.itba.cloud.queue.persistence.repository.UserAccountRepository;
import ar.edu.itba.cloud.queue.security.JwtService;
import ar.edu.itba.cloud.queue.service.command.LoginCommand;
import ar.edu.itba.cloud.queue.service.command.RegisterCommand;
import ar.edu.itba.cloud.queue.service.model.AuthResult;
import ar.edu.itba.cloud.queue.service.model.EstablishmentView;
import ar.edu.itba.cloud.queue.service.model.UserView;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Staff-side sign-up and sign-in. Customers never authenticate. */
@Service
public class AuthService {

    private static final int MIN_PASSWORD_LENGTH = 8;

    private final UserAccountRepository userRepository;
    private final EstablishmentRepository establishmentRepository;
    private final MembershipRepository membershipRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final Clock clock;

    public AuthService(UserAccountRepository userRepository,
                       EstablishmentRepository establishmentRepository,
                       MembershipRepository membershipRepository,
                       PasswordEncoder passwordEncoder,
                       JwtService jwtService,
                       Clock clock) {
        this.userRepository = userRepository;
        this.establishmentRepository = establishmentRepository;
        this.membershipRepository = membershipRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.clock = clock;
    }

    /** Creates the account, its establishment and the OWNER membership in one step. */
    @Transactional
    public AuthResult register(RegisterCommand command) {
        String email = normalizeEmail(command.email());
        validatePassword(command.password());

        if (userRepository.existsByEmailIgnoreCase(email)) {
            throw new ConflictException("EMAIL_TAKEN", "An account with this email already exists");
        }

        Instant now = clock.instant();
        UserAccount user = userRepository.save(new UserAccount(email,
                passwordEncoder.encode(command.password()),
                requireText(command.displayName(), "DISPLAY_NAME_REQUIRED", "A display name is required"),
                now));

        Establishment establishment = establishmentRepository.save(new Establishment(
                requireText(command.establishmentName(), "ESTABLISHMENT_NAME_REQUIRED",
                        "An establishment name is required"),
                resolveTimezone(command.timezone()),
                now));

        membershipRepository.save(new Membership(user, establishment, MembershipRole.OWNER, now));
        return authResult(user, establishment, MembershipRole.OWNER);
    }

    @Transactional(readOnly = true)
    public AuthResult login(LoginCommand command) {
        UserAccount user = userRepository.findByEmailIgnoreCase(normalizeEmail(command.email()))
                .orElseThrow(UnauthorizedException::badCredentials);

        if (command.password() == null || !passwordEncoder.matches(command.password(), user.getPasswordHash())) {
            throw UnauthorizedException.badCredentials();
        }

        // A user can belong to several establishments; the SPA opens on the first one they joined.
        List<Membership> memberships = membershipRepository.findAllByUserId(user.getId());
        Membership primary = memberships.isEmpty() ? null : memberships.getFirst();

        return primary == null
                ? authResult(user, null, null)
                : authResult(user, primary.getEstablishment(), primary.getRole());
    }

    @Transactional(readOnly = true)
    public UserView me(UUID userId) {
        return userRepository.findById(userId)
                .map(AuthService::toView)
                .orElseThrow(() -> NotFoundException.user(userId));
    }

    static UserView toView(UserAccount user) {
        return new UserView(user.getId(), user.getEmail(), user.getDisplayName(), user.getCreatedAt());
    }

    private AuthResult authResult(UserAccount user, Establishment establishment, MembershipRole role) {
        JwtService.IssuedToken token = jwtService.issue(user);
        EstablishmentView establishmentView = establishment == null ? null : new EstablishmentView(
                establishment.getId(), establishment.getName(), establishment.getTimezone(), role,
                establishment.getCreatedAt());

        return new AuthResult(token.value(), "Bearer", token.expiresInSeconds(), token.expiresAt(),
                toView(user), establishmentView);
    }

    private void validatePassword(String password) {
        if (password == null || password.length() < MIN_PASSWORD_LENGTH) {
            throw new ValidationException("WEAK_PASSWORD",
                    "Password must be at least %d characters long".formatted(MIN_PASSWORD_LENGTH));
        }
    }

    static String resolveTimezone(String timezone) {
        if (timezone == null || timezone.isBlank()) {
            return Establishment.DEFAULT_TIMEZONE;
        }
        try {
            return ZoneId.of(timezone.trim()).getId();
        } catch (Exception ex) {
            throw new ValidationException("INVALID_TIMEZONE", "'%s' is not a valid IANA time zone".formatted(timezone));
        }
    }

    static String normalizeEmail(String email) {
        String trimmed = email == null ? null : email.trim().toLowerCase(Locale.ROOT);
        if (trimmed == null || trimmed.isEmpty()) {
            throw new ValidationException("EMAIL_REQUIRED", "An email address is required");
        }
        return trimmed;
    }

    static String requireText(String value, String code, String message) {
        String trimmed = value == null ? null : value.trim();
        if (trimmed == null || trimmed.isEmpty()) {
            throw new ValidationException(code, message);
        }
        return trimmed;
    }
}
