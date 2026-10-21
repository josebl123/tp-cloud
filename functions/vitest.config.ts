import { defineConfig } from 'vitest/config'

// Dos proyectos: los unitarios del dominio corren en milisegundos y sin nada externo; los de
// integración levantan DynamoDB Local con Testcontainers, así que necesitan Docker.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/domain/**/*.test.ts', 'test/handlers/**/*.test.ts', 'test/notifications/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          // Bajar la imagen la primera vez puede tardar.
          hookTimeout: 180_000,
          testTimeout: 60_000,
          // Un solo contenedor compartido por todos los archivos de integración.
          globalSetup: ['test/integration/global-setup.ts'],
        },
      },
    ],
  },
})
