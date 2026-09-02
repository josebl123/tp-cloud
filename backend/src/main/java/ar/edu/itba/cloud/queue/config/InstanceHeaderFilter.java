package ar.edu.itba.cloud.queue.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Stamps every response with the instance that produced it.
 *
 * <p>Cheap, and it turns "is the load balancer really distributing?" from a claim into something
 * visible in browser dev tools or a {@code curl -I} loop.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class InstanceHeaderFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Instance-Id";

    private final InstanceIdentity identity;

    public InstanceHeaderFilter(InstanceIdentity identity) {
        this.identity = identity;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        // Set before the chain runs: a streaming response commits early and cannot take headers later.
        response.setHeader(HEADER, identity.id());
        chain.doFilter(request, response);
    }
}
