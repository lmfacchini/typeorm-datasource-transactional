import { CustomDecorator, SetMetadata } from "@nestjs/common";

export const TRANSACTIONAL_DECORATOR_KEY = "TRANSACTIONAL_DECORATOR_KEY";

export const Transactional = (
  propagation: Propagation
): CustomDecorator<string> =>
  SetMetadata(TRANSACTIONAL_DECORATOR_KEY, propagation);

export enum Propagation {
  REQUIRED = "REQUIRED",
  SUPPORTS = "SUPPORTS",
  MANDATORY = "MANDATORY",
  REQUIRES_NEW = "REQUIRES_NEW",
  NOT_SUPPORTED = "NOT_SUPPORTED",
  NEVER = "NEVER",
}
