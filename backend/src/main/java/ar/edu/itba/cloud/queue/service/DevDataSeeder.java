package ar.edu.itba.cloud.queue.service;

import ar.edu.itba.cloud.queue.persistence.entity.MembershipRole;
import ar.edu.itba.cloud.queue.persistence.entity.NoShowPolicy;
import ar.edu.itba.cloud.queue.persistence.entity.SupportedLocale;
import ar.edu.itba.cloud.queue.persistence.repository.UserAccountRepository;
import ar.edu.itba.cloud.queue.service.command.AddMemberCommand;
import ar.edu.itba.cloud.queue.service.command.CreateQueueCommand;
import ar.edu.itba.cloud.queue.service.command.JoinCommand;
import ar.edu.itba.cloud.queue.service.command.RegisterCommand;
import ar.edu.itba.cloud.queue.service.model.AuthResult;
import ar.edu.itba.cloud.queue.service.model.QueueView;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Demo data for local development, so the SPA has something real to talk to on first run.
 *
 * <p>Only active under {@code q.seed.enabled=true} (set by the {@code dev} profile) and idempotent:
 * it does nothing if the demo owner already exists.
 */
@Component
@ConditionalOnProperty(prefix = "q.seed", name = "enabled", havingValue = "true")
public class DevDataSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DevDataSeeder.class);

    private static final String OWNER_EMAIL = "owner@demo.q";
    private static final String STAFF_EMAIL = "staff@demo.q";
    private static final String PASSWORD = "demo1234";

    private final AuthService authService;
    private final EstablishmentService establishmentService;
    private final QueueService queueService;
    private final QueueEntryService entryService;
    private final UserAccountRepository userRepository;

    public DevDataSeeder(AuthService authService,
                         EstablishmentService establishmentService,
                         QueueService queueService,
                         QueueEntryService entryService,
                         UserAccountRepository userRepository) {
        this.authService = authService;
        this.establishmentService = establishmentService;
        this.queueService = queueService;
        this.entryService = entryService;
        this.userRepository = userRepository;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (userRepository.existsByEmailIgnoreCase(OWNER_EMAIL)) {
            log.info("Demo data already present, skipping seed");
            return;
        }

        AuthResult owner = authService.register(new RegisterCommand(
                OWNER_EMAIL, PASSWORD, "Demo Owner", "Parrilla La Espera", "America/Argentina/Buenos_Aires"));
        UUID ownerId = owner.user().id();
        UUID establishmentId = owner.establishment().id();

        establishmentService.addMember(ownerId, establishmentId,
                new AddMemberCommand(STAFF_EMAIL, PASSWORD, "Demo Staff", MembershipRole.STAFF));

        QueueView tables = queueService.create(ownerId, establishmentId, new CreateQueueCommand(
                "Tables", "Main dining room queue", 3, 25, null, 120,
                NoShowPolicy.MOVE_BACK, 2, 3, 10, true));

        queueService.create(ownerId, establishmentId, new CreateQueueCommand(
                "Take away", "Counter pickup for online orders", 1, 5, 20, 60,
                NoShowPolicy.MOVE_TO_END, 3, 2, 5, false));

        entryService.join(tables.id(), new JoinCommand("Ana Perez", "ana@demo.q", null, 2, SupportedLocale.ES));
        entryService.join(tables.id(), new JoinCommand("Bruno Diaz", null, "+541100000001", 4, SupportedLocale.ES));
        entryService.join(tables.id(), new JoinCommand("Carla Gomez", "carla@demo.q", "+541100000002", 3, SupportedLocale.EN));

        log.info("Seeded demo data: owner={} staff={} password={}", OWNER_EMAIL, STAFF_EMAIL, PASSWORD);
    }
}
