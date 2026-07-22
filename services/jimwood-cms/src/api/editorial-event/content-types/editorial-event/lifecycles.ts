import { errors } from '@strapi/utils';

const { ValidationError } = errors;

function rejectMutation() {
  throw new ValidationError('Editorial audit events are immutable.');
}

const lifecycles = {
  beforeUpdate: rejectMutation,
  beforeUpdateMany: rejectMutation,
  beforeDelete: rejectMutation,
  beforeDeleteMany: rejectMutation,
};

export default lifecycles;
