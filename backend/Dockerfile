# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build. A separate stage so the JDK, the Maven cache and the source tree stay
# out of what ships: the runtime image only needs the jar.
# ---------------------------------------------------------------------------
FROM maven:3.9-eclipse-temurin-25 AS build
WORKDIR /build

# Dependencies resolve from the POM alone, so this layer is only rebuilt when
# the POM changes - not on every edit to a source file.
COPY pom.xml ./
RUN --mount=type=cache,target=/root/.m2 mvn -q dependency:go-offline

COPY src ./src
# Tests need Docker for Testcontainers, which is not available inside a build.
# They run in CI and locally; see the README.
RUN --mount=type=cache,target=/root/.m2 mvn -q clean package -DskipTests \
    && mv target/queue-api-*.jar app.jar \
    && java -Djarmode=tools -jar app.jar extract --layers --launcher --destination extracted

# ---------------------------------------------------------------------------
# Runtime. JRE only: no compiler, no Maven, no source.
# ---------------------------------------------------------------------------
FROM eclipse-temurin:25-jre-alpine AS runtime

# curl is here for the health check below, and for reaching the actuator from a
# shell when something looks wrong on a running instance.
RUN apk add --no-cache curl \
    && addgroup -S queue && adduser -S -G queue -H -s /sbin/nologin queue

WORKDIR /app

# Copied in the order they change: dependencies almost never, the application on
# every build. Docker then re-uploads only the last, thin layer on a redeploy.
COPY --from=build --chown=queue:queue /build/extracted/dependencies/ ./
COPY --from=build --chown=queue:queue /build/extracted/spring-boot-loader/ ./
COPY --from=build --chown=queue:queue /build/extracted/snapshot-dependencies/ ./
COPY --from=build --chown=queue:queue /build/extracted/application/ ./

USER queue
EXPOSE 8080

# The JVM sees the container's limit, not the host's, so it sizes the heap
# against what it was actually given.
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+UseSerialGC -Djava.security.egd=file:/dev/./urandom"

# The readiness probe on purpose: it does not touch the database, so a busy
# connection pool cannot make Docker declare a healthy container unhealthy.
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=3 \
    CMD curl -fsS http://localhost:${PORT:-8080}/actuator/health/readiness || exit 1

# The jar was extracted into layers, so there is no jar to run: the loader starts it.
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
