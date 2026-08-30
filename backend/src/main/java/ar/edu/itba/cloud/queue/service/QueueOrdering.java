package ar.edu.itba.cloud.queue.service;

import ar.edu.itba.cloud.queue.persistence.entity.QueueEntry;
import ar.edu.itba.cloud.queue.persistence.entity.ServiceQueue;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Owns the sort keys that define the order of a line.
 *
 * <p>Entries carry a sparse {@code orderKey} rather than a dense position, so moving one customer does
 * not rewrite every row behind them. Keys are handed out {@link ServiceQueue#ORDER_KEY_GAP} apart,
 * leaving room to insert between neighbours; when a gap does run out the queue is re-normalised.
 */
@Component
public class QueueOrdering {

    /** Key that sorts after everyone currently in the line. */
    public long keyForEnd(ServiceQueue queue) {
        return queue.allocateOrderKey();
    }

    /**
     * Key that places an entry behind exactly {@code positionsBack} of the customers currently waiting.
     *
     * @param waiting       the WAITING entries in service order, not including the entry being placed
     * @param positionsBack how many waiting customers should end up ahead of it (at least one)
     */
    public long keyForPositionBack(ServiceQueue queue, List<QueueEntry> waiting, int positionsBack) {
        int target = Math.max(1, positionsBack);
        if (waiting.isEmpty() || target >= waiting.size()) {
            return keyForEnd(queue);
        }

        long midpoint = midpointBetween(waiting, target);
        if (midpoint > 0) {
            return midpoint;
        }

        // No room left between the two neighbours: spread the whole line out again and retry.
        renormalize(queue, waiting);
        return midpointBetween(waiting, target);
    }

    /** Rewrites the line with evenly spaced keys, preserving the current order. */
    public void renormalize(ServiceQueue queue, List<QueueEntry> waiting) {
        long key = ServiceQueue.ORDER_KEY_GAP;
        for (QueueEntry entry : waiting) {
            entry.setOrderKey(key);
            key += ServiceQueue.ORDER_KEY_GAP;
        }
        queue.ensureOrderKeyAbove(key);
    }

    /** Returns a key strictly between the two neighbours, or -1 when they are already adjacent. */
    private long midpointBetween(List<QueueEntry> waiting, int target) {
        long lower = waiting.get(target - 1).getOrderKey();
        long upper = waiting.get(target).getOrderKey();
        long midpoint = lower + (upper - lower) / 2;
        return midpoint > lower && midpoint < upper ? midpoint : -1L;
    }
}
