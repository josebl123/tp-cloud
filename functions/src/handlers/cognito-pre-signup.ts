import type { PreSignUpTriggerEvent } from 'aws-lambda'

/**
 * λ cognito-pre-signup: Cognito la invoca antes de crear cada cuenta, y la confirma en el acto.
 *
 * El registro del staff queda en un solo paso, como en la versión Java: sin código por email, que
 * dependería del límite de 50 envíos diarios del email de Cognito. A cambio, no se verifica que el
 * email sea de quien se registra; para un panel de staff que se da de alta a sí mismo, alcanza.
 */
export const handler = async (event: PreSignUpTriggerEvent): Promise<PreSignUpTriggerEvent> => {
  // Solo el registro propio. Las cuentas que crea el dueño desde el panel (o Terraform para la demo)
  // pasan por AdminCreateUser, que ya las deja confirmadas con su contraseña.
  if (event.triggerSource === 'PreSignUp_SignUp') {
    event.response.autoConfirmUser = true
    if (event.request.userAttributes['email']) event.response.autoVerifyEmail = true
  }
  return event
}
