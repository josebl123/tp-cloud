package ar.edu.itba.cloud.queue.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * How often subscribers are refreshed, and how many refreshes of one queue may overlap.
 *
 * <p>These are timing tests, so the window is deliberately short and the waits are generous - they
 * assert behaviour, never a schedule.
 */
@DisplayName("Broadcast coalescing")
class BroadcastCoordinatorTest {

    private static final Duration WINDOW = Duration.ofMillis(80);
    private static final long SETTLE_MS = 1200;

    private RealtimeBroadcaster broadcaster;
    private BroadcastCoordinator coordinator;
    private UUID queueId;

    @BeforeEach
    void setUp() {
        broadcaster = mock(RealtimeBroadcaster.class);
        coordinator = new BroadcastCoordinator(broadcaster, WINDOW);
        queueId = UUID.randomUUID();
    }

    @AfterEach
    void tearDown() {
        coordinator.close();
    }

    @Test
    @DisplayName("a burst of changes to one queue becomes a single refresh")
    void aBurstCollapses() {
        for (int change = 0; change < 10; change++) {
            coordinator.request(queueId);
        }

        // The refresh reads current state rather than replaying events, so one refresh after ten
        // changes carries the same answer as ten would have - sent once.
        verify(broadcaster, timeout(SETTLE_MS)).broadcast(queueId);
        verify(broadcaster, times(1)).broadcast(queueId);
    }

    @Test
    @DisplayName("a change arriving mid-refresh causes exactly one follow-up, however many arrive")
    void changesDuringARefreshCollapseIntoOneFollowUp() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        doAnswer(invocation -> {
            started.countDown();
            release.await(SETTLE_MS, TimeUnit.MILLISECONDS);
            return null;
        }).doNothing().when(broadcaster).broadcast(queueId);

        coordinator.request(queueId);
        assertThat(started.await(SETTLE_MS, TimeUnit.MILLISECONDS)).isTrue();

        // Five more changes while the first refresh is still in flight.
        for (int change = 0; change < 5; change++) {
            coordinator.request(queueId);
        }
        release.countDown();

        verify(broadcaster, timeout(SETTLE_MS).times(2)).broadcast(queueId);
        Thread.sleep(300);
        verify(broadcaster, times(2)).broadcast(queueId);
    }

    @Test
    @DisplayName("queues are independent of one another")
    void queuesDoNotBlockEachOther() {
        UUID other = UUID.randomUUID();

        coordinator.request(queueId);
        coordinator.request(other);

        verify(broadcaster, timeout(SETTLE_MS)).broadcast(queueId);
        verify(broadcaster, timeout(SETTLE_MS)).broadcast(other);
        assertThat(coordinator.trackedQueues()).isEqualTo(2);
    }

    @Test
    @DisplayName("changes after the window has passed are refreshed again, not swallowed")
    void laterChangesStillRefresh() throws Exception {
        coordinator.request(queueId);
        verify(broadcaster, timeout(SETTLE_MS)).broadcast(queueId);

        Thread.sleep(200);
        coordinator.request(queueId);

        verify(broadcaster, timeout(SETTLE_MS).times(2)).broadcast(queueId);
    }

    @Test
    @DisplayName("a refresh that throws does not wedge the queue")
    void aFailedRefreshReleasesTheQueue() throws Exception {
        doThrow(new IllegalStateException("database unavailable"))
                .doNothing()
                .when(broadcaster).broadcast(queueId);

        coordinator.request(queueId);
        verify(broadcaster, timeout(SETTLE_MS)).broadcast(queueId);

        Thread.sleep(200);
        coordinator.request(queueId);

        // If the failure had left the queue marked as running, this second refresh would never come.
        verify(broadcaster, timeout(SETTLE_MS).times(2)).broadcast(queueId);
    }

    @Test
    @DisplayName("requesting is cheap and never blocks on the refresh")
    void requestingDoesNotBlock() throws Exception {
        CountDownLatch release = new CountDownLatch(1);
        doAnswer(invocation -> {
            release.await(SETTLE_MS, TimeUnit.MILLISECONDS);
            return null;
        }).when(broadcaster).broadcast(any());

        coordinator.request(queueId);
        Thread.sleep(200);

        // A refresh is now blocked. The caller - in production, the thread reading the database
        // connection - must still return immediately.
        long start = System.nanoTime();
        for (int change = 0; change < 1000; change++) {
            coordinator.request(queueId);
        }
        long elapsedMillis = (System.nanoTime() - start) / 1_000_000;

        release.countDown();
        assertThat(elapsedMillis)
                .as("a thousand requests against a blocked queue should cost nothing")
                .isLessThan(200);
    }

    @Test
    @DisplayName("a stalled queue does not stop other queues being refreshed")
    void aStalledQueueDoesNotStallTheRest() throws Exception {
        UUID stalled = UUID.randomUUID();
        UUID healthy = UUID.randomUUID();
        CountDownLatch release = new CountDownLatch(1);

        doAnswer(invocation -> {
            release.await(SETTLE_MS, TimeUnit.MILLISECONDS);
            return null;
        }).when(broadcaster).broadcast(stalled);
        doNothing().when(broadcaster).broadcast(healthy);

        coordinator.request(stalled);
        Thread.sleep(200);
        coordinator.request(healthy);

        // This is the whole point of moving the work off the listener thread: a customer on a bad
        // connection stalls their own queue and nothing else.
        verify(broadcaster, timeout(SETTLE_MS).atLeastOnce()).broadcast(healthy);
        release.countDown();
    }
}
