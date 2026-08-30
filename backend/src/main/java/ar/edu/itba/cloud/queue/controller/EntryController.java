package ar.edu.itba.cloud.queue.controller;

import ar.edu.itba.cloud.queue.controller.dto.EntryStatusRequest;
import ar.edu.itba.cloud.queue.security.AuthenticatedUser;
import ar.edu.itba.cloud.queue.security.CurrentUser;
import ar.edu.itba.cloud.queue.service.QueueEntryService;
import ar.edu.itba.cloud.queue.service.model.EntryView;
import ar.edu.itba.cloud.queue.service.model.NotificationView;
import ar.edu.itba.cloud.queue.service.model.QueueEventView;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Individual customers, from the staff side.
 *
 * <p>All the transitions go through one status endpoint. The legal moves live in the service layer,
 * so the API surface stays small and the rules stay in one place.
 */
@RestController
@RequestMapping("/api/v1/entries")
@Tag(name = "Entries (staff)", description = "Move a customer through the queue")
public class EntryController {

    private final QueueEntryService entryService;

    public EntryController(QueueEntryService entryService) {
        this.entryService = entryService;
    }

    @GetMapping("/{entryId}")
    public EntryView get(@CurrentUser AuthenticatedUser user, @PathVariable UUID entryId) {
        return entryService.get(user.id(), entryId);
    }

    @PutMapping("/{entryId}/status")
    @Operation(summary = "Move the customer to a new state",
            description = """
                    * `CALLED` - call this customer, starting their grace period
                    * `SERVING` - they showed up and are being attended
                    * `SERVED` - service finished; this measurement feeds future estimates
                    * `NO_SHOW` - absent; the queue's no-show policy is applied
                    * `LEFT` - removed from the line
                    * `WAITING` - back in line (keeps their place when undoing a call, goes to the
                      end when bringing back somebody who had already left)
                    """)
    public EntryView changeStatus(@CurrentUser AuthenticatedUser user,
                                  @PathVariable UUID entryId,
                                  @Valid @RequestBody EntryStatusRequest request) {
        return entryService.transition(user.id(), entryId, request.status());
    }

    @GetMapping("/{entryId}/events")
    public List<QueueEventView> events(@CurrentUser AuthenticatedUser user, @PathVariable UUID entryId) {
        return entryService.events(user.id(), entryId);
    }

    @GetMapping("/{entryId}/notifications")
    public List<NotificationView> notifications(@CurrentUser AuthenticatedUser user, @PathVariable UUID entryId) {
        return entryService.notifications(user.id(), entryId);
    }
}
