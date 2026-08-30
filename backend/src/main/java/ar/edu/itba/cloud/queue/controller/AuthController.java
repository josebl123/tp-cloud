package ar.edu.itba.cloud.queue.controller;

import ar.edu.itba.cloud.queue.controller.dto.LoginRequest;
import ar.edu.itba.cloud.queue.controller.dto.RegisterRequest;
import ar.edu.itba.cloud.queue.security.AuthenticatedUser;
import ar.edu.itba.cloud.queue.security.CurrentUser;
import ar.edu.itba.cloud.queue.service.AuthService;
import ar.edu.itba.cloud.queue.service.model.AuthResult;
import ar.edu.itba.cloud.queue.service.model.UserView;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
@Tag(name = "Auth", description = "Staff sign-up and sign-in. Customers never authenticate.")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/register")
    @Operation(summary = "Create an account, its establishment and an OWNER membership")
    public ResponseEntity<AuthResult> register(@Valid @RequestBody RegisterRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(authService.register(request.toCommand()));
    }

    @PostMapping("/login")
    @Operation(summary = "Exchange credentials for a bearer token")
    public AuthResult login(@Valid @RequestBody LoginRequest request) {
        return authService.login(request.toCommand());
    }

    @GetMapping("/me")
    @Operation(summary = "The account behind the current token")
    public UserView me(@CurrentUser AuthenticatedUser user) {
        return authService.me(user.id());
    }
}
