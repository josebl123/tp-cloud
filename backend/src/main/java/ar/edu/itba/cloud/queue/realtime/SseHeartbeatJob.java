package ar.edu.itba.cloud.queue.realtime;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Sends a comment line on every open stream so proxies do not reap idle connections. */
@Component
public class SseHeartbeatJob {

    private final SseHub hub;

    public SseHeartbeatJob(SseHub hub) {
        this.hub = hub;
    }

    @Scheduled(fixedDelayString = "${q.sse.heartbeat-interval:20s}")
    public void beat() {
        hub.heartbeat();
    }
}
