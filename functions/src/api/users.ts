// Los usuarios viven en Cognito. Esta interfaz es lo único que la API necesita de ellos, así los
// handlers se prueban sin AWS y la implementación real queda en un solo lugar.

import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  InvalidParameterException,
  InvalidPasswordException,
  ListUsersCommand,
  UserNotFoundException,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider'
import type { AttributeType } from '@aws-sdk/client-cognito-identity-provider'
import { badRequest, HttpError } from '../http/api.js'
import type { UserView } from './views.js'

export interface UserDirectory {
  get(sub: string): Promise<UserView | null>
  findByEmail(email: string): Promise<UserView | null>
  /** Crea una cuenta ya confirmada, con contraseña definitiva: la da de alta el dueño del local. */
  create(input: { email: string; password: string; displayName: string }): Promise<UserView>
}

const attribute = (attributes: AttributeType[] | undefined, name: string) =>
  attributes?.find((candidate) => candidate.Name === name)?.Value

function toUser(attributes: AttributeType[] | undefined, created: Date | undefined, fallbackId: string): UserView {
  const email = attribute(attributes, 'email') ?? ''
  return {
    id: attribute(attributes, 'sub') ?? fallbackId,
    email,
    displayName: attribute(attributes, 'name') ?? email,
    createdAt: (created ?? new Date(0)).toISOString(),
  }
}

export class CognitoUsers implements UserDirectory {
  constructor(
    private readonly userPoolId: string,
    private readonly client = new CognitoIdentityProviderClient({}),
  ) {}

  async get(sub: string): Promise<UserView | null> {
    try {
      // Con el email como atributo de inicio de sesión, el `Username` interno es el `sub`.
      const user = await this.client.send(new AdminGetUserCommand({ UserPoolId: this.userPoolId, Username: sub }))
      return toUser(user.UserAttributes, user.UserCreateDate, sub)
    } catch (error) {
      if (error instanceof UserNotFoundException) return null
      throw error
    }
  }

  async findByEmail(email: string): Promise<UserView | null> {
    // El email ya pasó por la validación de formato, así que no trae comillas que rompan el filtro.
    const { Users } = await this.client.send(
      new ListUsersCommand({ UserPoolId: this.userPoolId, Filter: `email = "${email}"`, Limit: 1 }),
    )
    const user = Users?.[0]
    return user ? toUser(user.Attributes, user.UserCreateDate, user.Username ?? '') : null
  }

  async create(input: { email: string; password: string; displayName: string }): Promise<UserView> {
    try {
      const { User } = await this.client.send(
        new AdminCreateUserCommand({
          UserPoolId: this.userPoolId,
          Username: input.email,
          UserAttributes: [
            { Name: 'email', Value: input.email },
            { Name: 'email_verified', Value: 'true' },
            { Name: 'name', Value: input.displayName },
          ],
          // Sin el email de bienvenida de Cognito: el dueño le pasa la contraseña a su empleado.
          MessageAction: 'SUPPRESS',
        }),
      )
      const sub = attribute(User?.Attributes, 'sub') ?? User?.Username ?? input.email
      try {
        await this.client.send(
          new AdminSetUserPasswordCommand({
            UserPoolId: this.userPoolId,
            Username: sub,
            Password: input.password,
            Permanent: true,
          }),
        )
      } catch (error) {
        // Sin contraseña la cuenta no sirve, y si quedara, el reintento la encontraría y la agregaría
        // igual: se borra para que el dueño pueda volver a intentar con otra contraseña.
        await this.client.send(new AdminDeleteUserCommand({ UserPoolId: this.userPoolId, Username: sub }))
        throw error
      }
      return toUser(User?.Attributes, User?.UserCreateDate, sub)
    } catch (error) {
      if (error instanceof UsernameExistsException) {
        throw new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists')
      }
      if (error instanceof InvalidPasswordException || error instanceof InvalidParameterException) {
        throw badRequest('VALIDATION_FAILED', 'The password does not meet the policy', { password: error.message })
      }
      throw error
    }
  }
}
