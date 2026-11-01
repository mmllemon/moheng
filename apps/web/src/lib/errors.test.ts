import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../api';
import { describeError } from './errors';

test('5xx 定性为服务端错误，并保留错误码', () => {
  const view = describeError(new ApiError('column Project.workspaceRoot does not exist', 'INTERNAL_ERROR', 500));
  assert.equal(view.title, '服务端出错了');
  assert.equal(view.code, 'INTERNAL_ERROR');
  assert.match(view.hint, /数据库迁移/);
});

test('403 定性为权限问题，不再显示通用文案', () => {
  const view = describeError(new ApiError('forbidden', 'FORBIDDEN', 403));
  assert.equal(view.title, '没有访问权限');
  assert.match(view.hint, /授权/);
});

test('401 定性为登录失效', () => {
  assert.equal(describeError(new ApiError('unauthorized', 'UNAUTHORIZED', 401)).title, '登录状态已失效');
});

test('网络失败单独定性，提示检查后端', () => {
  const view = describeError(new TypeError('Failed to fetch'));
  assert.equal(view.title, '网络连接失败');
  assert.match(view.hint, /后端/);
});

test('未知错误回落到通用文案，但仍带原始信息', () => {
  const view = describeError(new Error('boom'), '兜底文案');
  assert.equal(view.title, '数据暂时不可用');
  assert.equal(view.hint, 'boom');
  const empty = describeError(undefined, '兜底文案');
  assert.equal(empty.hint, '兜底文案');
});
