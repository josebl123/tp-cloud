package ar.edu.itba.cloud.queue.integration;

import static org.assertj.core.api.Assertions.assertThat;

import ar.edu.itba.cloud.queue.service.QueueService;
import ar.edu.itba.cloud.queue.service.model.QueueBroadcast;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.EntityManagerFactory;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * A queue movement has to reach the staff board and every customer watching their own ticket.
 *
 * <p>Written naively that is one set of queries per subscriber, all asking the same questions about
 * the same queue — so database load grows with the size of the audience rather than with the amount
 * of work being done. A queue with forty people watching would issue roughly forty times the queries
 * of a queue with one, for identical information.
 *
 * <p>These tests pin the fix: the cost of a broadcast is flat.
 */
@DisplayName("Broadcast cost does not grow with the audience")
class BroadcastFanOutIntegrationTest extends AbstractIntegrationTest {

    /** Generous, but far below anything that scales with the audience. */
    private static final long CEILING = 8;

    @Autowired
    private QueueService queueService;

    @Autowired
    private EntityManagerFactory entityManagerFactory;

    @Test
    @DisplayName("one watcher and twenty watchers cost the same")
    void costIsFlat() throws Exception {
        Account owner = registerOwner("owner@fanout.q", "Local fanout");
        UUID queueId = createQueue(owner, "Fila", Map.of());

        Set<UUID> tokens = new LinkedHashSet<>();
        for (int index = 1; index <= 20; index++) {
            JsonNode ticket = join(queueId, "Cliente " + index, "c%d@fanout.q".formatted(index));
            tokens.add(ticketToken(ticket));
        }

        long forOne = statementsFor(queueId, Set.of(tokens.iterator().next()));
        long forTwenty = statementsFor(queueId, tokens);

        assertThat(forTwenty)
                .as("twenty watchers must not cost more than one")
                .isEqualTo(forOne);
        assertThat(forTwenty).isLessThanOrEqualTo(CEILING);
    }

    @Test
    @DisplayName("watchers still in the line cost no query of their own")
    void watchersInLineAreAlreadyLoaded() throws Exception {
        Account owner = registerOwner("owner@inline.q", "Local inline");
        UUID queueId = createQueue(owner, "Fila", Map.of());

        Set<UUID> tokens = new LinkedHashSet<>();
        for (int index = 1; index <= 5; index++) {
            tokens.add(ticketToken(join(queueId, "Cliente " + index, "i%d@inline.q".formatted(index))));
        }

        // The entries loaded for the board already cover everyone waiting, so adding watchers who are
        // in the line adds nothing at all.
        assertThat(statementsFor(queueId, tokens)).isEqualTo(statementsFor(queueId, Set.of()));
    }

    @Test
    @DisplayName("a watcher who has left the line is fetched, and all of them in one statement")
    void watchersOutOfLineCostOneBatchedQuery() throws Exception {
        Account owner = registerOwner("owner@left.q", "Local left");
        UUID queueId = createQueue(owner, "Fila", Map.of());

        Set<UUID> gone = new LinkedHashSet<>();
        for (int index = 1; index <= 4; index++) {
            UUID token = ticketToken(join(queueId, "Cliente " + index, "l%d@left.q".formatted(index)));
            doDelete("/api/v1/public/tickets/" + token, null, 200);   // they leave the queue
            gone.add(token);
        }

        long baseline = statementsFor(queueId, Set.of());
        long withFour = statementsFor(queueId, gone);

        assertThat(withFour)
                .as("four departed watchers should cost exactly one extra, batched, statement")
                .isEqualTo(baseline + 1);
    }

    @Test
    @DisplayName("every watcher still receives a correct, individual view")
    void everyWatcherStillGetsTheirOwnView() throws Exception {
        Account owner = registerOwner("owner@views.q", "Local views");
        UUID queueId = createQueue(owner, "Fila", Map.of());

        Set<UUID> tokens = new LinkedHashSet<>();
        for (int index = 1; index <= 6; index++) {
            tokens.add(ticketToken(join(queueId, "Cliente " + index, "v%d@views.q".formatted(index))));
        }

        QueueBroadcast broadcast = queueService.readBroadcast(queueId, tokens, true);

        assertThat(broadcast.tickets()).hasSize(6);
        assertThat(broadcast.snapshot()).isNotNull();
        assertThat(broadcast.snapshot().waitingCount()).isEqualTo(6);
        // Efficiency must not have cost correctness: positions are still 1..6, one each.
        assertThat(broadcast.tickets().values())
                .extracting(view -> view.position())
                .containsExactlyInAnyOrder(1, 2, 3, 4, 5, 6);
    }

    @Test
    @DisplayName("the board is not built when no staff are connected")
    void skipsTheBoardWhenNobodyIsWatchingIt() throws Exception {
        Account owner = registerOwner("owner@noboard.q", "Local noboard");
        UUID queueId = createQueue(owner, "Fila", Map.of());
        UUID token = ticketToken(join(queueId, "Ana", "ana@noboard.q"));

        QueueBroadcast broadcast = queueService.readBroadcast(queueId, Set.of(token), false);

        assertThat(broadcast.snapshot()).isNull();
        assertThat(broadcast.tickets()).hasSize(1);
    }

    /** JDBC statements issued while assembling one broadcast. */
    private long statementsFor(UUID queueId, Set<UUID> tokens) {
        Statistics statistics = entityManagerFactory.unwrap(SessionFactory.class).getStatistics();
        statistics.clear();
        queueService.readBroadcast(queueId, tokens, true);
        return statistics.getPrepareStatementCount();
    }
}
