package ar.edu.itba.cloud.queue.service;

import ar.edu.itba.cloud.queue.exception.ConflictException;
import ar.edu.itba.cloud.queue.exception.NotFoundException;
import ar.edu.itba.cloud.queue.persistence.entity.Establishment;
import ar.edu.itba.cloud.queue.persistence.entity.Membership;
import ar.edu.itba.cloud.queue.persistence.entity.MembershipRole;
import ar.edu.itba.cloud.queue.persistence.entity.UserAccount;
import ar.edu.itba.cloud.queue.persistence.repository.EstablishmentRepository;
import ar.edu.itba.cloud.queue.persistence.repository.MembershipRepository;
import ar.edu.itba.cloud.queue.persistence.repository.UserAccountRepository;
import ar.edu.itba.cloud.queue.service.command.AddMemberCommand;
import ar.edu.itba.cloud.queue.service.command.EstablishmentCommand;
import ar.edu.itba.cloud.queue.service.model.EstablishmentView;
import ar.edu.itba.cloud.queue.service.model.MemberView;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Establishments and the staff who work in them. */
@Service
public class EstablishmentService {

    private final EstablishmentRepository establishmentRepository;
    private final MembershipRepository membershipRepository;
    private final UserAccountRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final AccessGuard accessGuard;
    private final Clock clock;

    public EstablishmentService(EstablishmentRepository establishmentRepository,
                                MembershipRepository membershipRepository,
                                UserAccountRepository userRepository,
                                PasswordEncoder passwordEncoder,
                                AccessGuard accessGuard,
                                Clock clock) {
        this.establishmentRepository = establishmentRepository;
        this.membershipRepository = membershipRepository;
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.accessGuard = accessGuard;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<EstablishmentView> listForUser(UUID userId) {
        return membershipRepository.findAllByUserId(userId).stream()
                .map(membership -> toView(membership.getEstablishment(), membership.getRole()))
                .toList();
    }

    @Transactional
    public EstablishmentView create(UUID userId, EstablishmentCommand command) {
        UserAccount user = userRepository.findById(userId).orElseThrow(() -> NotFoundException.user(userId));
        Instant now = clock.instant();

        Establishment establishment = establishmentRepository.save(new Establishment(
                AuthService.requireText(command.name(), "ESTABLISHMENT_NAME_REQUIRED",
                        "An establishment name is required"),
                AuthService.resolveTimezone(command.timezone()),
                now));
        membershipRepository.save(new Membership(user, establishment, MembershipRole.OWNER, now));
        return toView(establishment, MembershipRole.OWNER);
    }

    @Transactional(readOnly = true)
    public EstablishmentView get(UUID userId, UUID establishmentId) {
        Membership membership = accessGuard.requireMember(userId, establishmentId);
        return toView(membership.getEstablishment(), membership.getRole());
    }

    @Transactional
    public EstablishmentView update(UUID userId, UUID establishmentId, EstablishmentCommand command) {
        accessGuard.requireOwner(userId, establishmentId);
        Establishment establishment = establishmentRepository.findById(establishmentId)
                .orElseThrow(() -> NotFoundException.establishment(establishmentId));

        if (command.name() != null) {
            establishment.setName(AuthService.requireText(command.name(), "ESTABLISHMENT_NAME_REQUIRED",
                    "An establishment name is required"));
        }
        if (command.timezone() != null) {
            establishment.setTimezone(AuthService.resolveTimezone(command.timezone()));
        }
        establishmentRepository.save(establishment);
        return toView(establishment, MembershipRole.OWNER);
    }

    @Transactional(readOnly = true)
    public List<MemberView> listMembers(UUID userId, UUID establishmentId) {
        accessGuard.requireMember(userId, establishmentId);
        return membershipRepository.findAllByEstablishmentId(establishmentId).stream()
                .map(EstablishmentService::toView)
                .toList();
    }

    /** Links an existing account, or creates one when the email is unknown. Owner only. */
    @Transactional
    public MemberView addMember(UUID userId, UUID establishmentId, AddMemberCommand command) {
        accessGuard.requireOwner(userId, establishmentId);
        Establishment establishment = establishmentRepository.findById(establishmentId)
                .orElseThrow(() -> NotFoundException.establishment(establishmentId));

        String email = AuthService.normalizeEmail(command.email());
        Instant now = clock.instant();

        UserAccount user = userRepository.findByEmailIgnoreCase(email).orElseGet(() -> {
            if (command.password() == null || command.password().length() < 8) {
                throw new ar.edu.itba.cloud.queue.exception.ValidationException("WEAK_PASSWORD",
                        "A password of at least 8 characters is required to create a new member account");
            }
            return userRepository.save(new UserAccount(email, passwordEncoder.encode(command.password()),
                    AuthService.requireText(command.displayName(), "DISPLAY_NAME_REQUIRED",
                            "A display name is required"),
                    now));
        });

        if (membershipRepository.existsByUserIdAndEstablishmentId(user.getId(), establishmentId)) {
            throw new ConflictException("ALREADY_A_MEMBER", "This user already belongs to the establishment");
        }

        MembershipRole role = command.role() == null ? MembershipRole.STAFF : command.role();
        Membership membership = membershipRepository.save(new Membership(user, establishment, role, now));
        return toView(membership);
    }

    private static EstablishmentView toView(Establishment establishment, MembershipRole role) {
        return new EstablishmentView(establishment.getId(), establishment.getName(),
                establishment.getTimezone(), role, establishment.getCreatedAt());
    }

    private static MemberView toView(Membership membership) {
        UserAccount user = membership.getUser();
        return new MemberView(membership.getId(), user.getId(), user.getEmail(), user.getDisplayName(),
                membership.getRole(), membership.getCreatedAt());
    }
}
