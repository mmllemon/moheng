import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AuiIf,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUp, CircleAlert, Square } from 'lucide-react';
import {
  ApiError,
} from '../../api';
import {
  cancelAssistantRun,
  createRequestId,
  submitAssistantMessage,
  type AssistantConversationDetail,
  type AssistantMessage,
} from '../../assistant-api';

const QUICK_PROMPTS = [
  { title: '项目经营概览', label: '合同、成本与进度款口径', prompt: '请概览当前项目经营情况，并说明各项金额的来源口径、统计时间和限制。' },
  { title: '成本偏差分析', label: '目标成本与已记录实际成本', prompt: '请比较当前项目目标成本与已记录实际成本，解释差异，并明确这不代表预计完工成本或会计利润。' },
  { title: '分供资金核对', label: '付款、退款、净支付与应付', prompt: '请核对当前项目的分供合同实际付款与退款，分别说明累计付款、累计退款、净支付与已登记应付的差异；若流水被截断，请明确说明。' },
  { title: '变更资料检查', label: '内审与外部确认资料缺口', prompt: '请检查当前项目变更签证资料完整性，区分内部审批和外部业主确认，不要作出审批或法律效力结论。' },
];

function toThreadMessage(message: AssistantMessage): ThreadMessageLike {
  return {
    id: message.id,
    role: message.role === 'USER' ? 'user' : 'assistant',
    content: [{ type: 'text', text: message.content }],
    createdAt: new Date(message.createdAt),
  };
}

function extractText(message: AppendMessage) {
  return message.content
    .filter((part): part is Extract<(typeof message.content)[number], { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

export function AssistantThread({
  conversation,
  onRun,
  activeRunId,
  activeRunStatus,
}: {
  conversation: AssistantConversationDetail;
  onRun: (conversationId: string, runId: string) => Promise<void>;
  activeRunId: string | null;
  activeRunStatus: string | null;
}) {
  const [messages, setMessages] = useState<readonly AssistantMessage[]>(conversation.messages);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');
  const [retryableSubmission, setRetryableSubmission] = useState<RetryableSubmission | null>(null);
  const activeRunIdRef = useRef<string | null>(activeRunId);
  const mountedConversationId = conversation.id;
  const hasActiveRun = activeRunStatus === 'QUEUED' || activeRunStatus === 'RUNNING';
  const isRunning = isSubmitting || hasActiveRun;
  const activeRunRecord = activeRunId ? conversation.runs.find((run) => run.id === activeRunId) : undefined;
  const activeRunMessage = activeRunRecord
    ? messages.find((item) => item.role === 'USER' && item.requestId === activeRunRecord.requestId)
    : undefined;
  const canRetryFailedRun = !retryableSubmission && conversation.status === 'ACTIVE' && !isRunning
    && activeRunStatus === 'FAILED' && activeRunRecord?.status === 'FAILED' && Boolean(activeRunMessage);
  const canReconnectActiveRun = !retryableSubmission && conversation.status === 'ACTIVE' && !isRunning
    && activeRunStatus === 'FAILED' && Boolean(activeRunId)
    && (activeRunRecord?.status === 'QUEUED' || activeRunRecord?.status === 'RUNNING');

  useEffect(() => {
    setMessages(conversation.messages);
    setLocalError('');
    setRetryableSubmission(null);
  }, [conversation.id, conversation.messages]);

  useEffect(() => {
    activeRunIdRef.current = activeRunId;
  }, [activeRunId]);

  const submitPendingMessage = useCallback(async (pending: RetryableSubmission) => {
    setLocalError('');
    setIsSubmitting(true);
    setMessages((current) => current.map((item) => item.id === pending.optimisticId ? { ...item, status: 'PENDING' } : item));
    try {
      // Keep the original requestId for retries. If the first response was lost after the
      // server accepted the message, the API idempotency key replays that run instead of duplicating it.
      const run = await submitAssistantMessage(mountedConversationId, pending.content, pending.requestId);
      setRetryableSubmission(null);
      activeRunIdRef.current = run.runId;
      await onRun(mountedConversationId, run.runId);
    } catch (error) {
      const messageText = error instanceof ApiError ? error.message : '提交失败或连接中断，请使用原请求编号重试。';
      setLocalError(messageText);
      setMessages((current) => current.map((item) => item.id === pending.optimisticId ? { ...item, status: 'FAILED' } : item));
      setRetryableSubmission(pending);
    } finally {
      setIsSubmitting(false);
    }
  }, [mountedConversationId, onRun]);

  const onNew = useCallback(async (message: AppendMessage) => {
    const content = extractText(message);
    if (!content) return;
    setLocalError('');
    setRetryableSubmission(null);
    const requestId = createRequestId();
    const optimistic: AssistantMessage = {
      id: `local-${requestId}`,
      conversationId: mountedConversationId,
      requestId,
      role: 'USER',
      content,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    await submitPendingMessage({ requestId, optimisticId: optimistic.id, content });
  }, [mountedConversationId, submitPendingMessage]);

  const retryFailedSubmission = useCallback(() => {
    const pending = retryableSubmission;
    if (!pending || isRunning || conversation.status !== 'ACTIVE') return;
    void submitPendingMessage(pending);
  }, [retryableSubmission, isRunning, conversation.status, submitPendingMessage]);

  const retryFailedRun = useCallback(() => {
    const original = activeRunMessage;
    if (!original || !canRetryFailedRun) return;
    const requestId = createRequestId();
    const optimistic: AssistantMessage = {
      id: `local-${requestId}`,
      conversationId: mountedConversationId,
      requestId,
      role: 'USER',
      content: original.content,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    };
    setLocalError('');
    setRetryableSubmission(null);
    setMessages((current) => [...current, optimistic]);
    void submitPendingMessage({ requestId, optimisticId: optimistic.id, content: original.content });
  }, [activeRunMessage, canRetryFailedRun, mountedConversationId, submitPendingMessage]);

  const reconnectActiveRun = useCallback(async () => {
    if (!activeRunId || !canReconnectActiveRun) return;
    setLocalError('');
    setIsSubmitting(true);
    try {
      await onRun(mountedConversationId, activeRunId);
    } catch (error) {
      setLocalError(error instanceof ApiError ? error.message : '重新连接失败，请刷新会话状态后重试。');
    } finally {
      setIsSubmitting(false);
    }
  }, [activeRunId, canReconnectActiveRun, mountedConversationId, onRun]);

  const onCancel = useCallback(async () => {
    const runId = activeRunIdRef.current;
    if (!runId) return;
    try {
      await cancelAssistantRun(mountedConversationId, runId);
    } catch (error) {
      setLocalError(error instanceof ApiError ? error.message : '取消请求未能送达，请稍后检查运行状态。');
    }
  }, [mountedConversationId]);

  const runtime = useExternalStoreRuntime<AssistantMessage>({
    messages,
    convertMessage: toThreadMessage,
    onNew,
    onCancel,
    isRunning,
    isSendDisabled: conversation.status !== 'ACTIVE' || isRunning,
  });

  return <AssistantRuntimeProvider runtime={runtime}>
    <div className="assistant-thread-shell">
      <ThreadPrimitive.Root className="assistant-thread-root">
        <AuiIf condition={(state) => state.thread.isEmpty}>
          <div className="assistant-empty-state">
            <span className="assistant-empty-mark" aria-hidden="true">M</span>
            <p className="assistant-empty-kicker">MOHENG · COST INTELLIGENCE</p>
            <h2>先从一个具体的成本问题开始。</h2>
            <p className="assistant-empty-description">只读取当前授权项目的业务台账。回答会说明统计口径与数据限制，不代替审批、结算或财务判断。</p>
            <div className="assistant-prompt-grid">
              {QUICK_PROMPTS.map((item) => <ThreadPrimitive.Suggestion key={item.title} prompt={item.prompt} send className="assistant-prompt-card">
                <span>{item.title}</span><small>{item.label}</small><ArrowUp size={14} />
              </ThreadPrimitive.Suggestion>)}
            </div>
          </div>
        </AuiIf>
        <ThreadPrimitive.Viewport className="assistant-thread-viewport" aria-label="成本助手对话记录">
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
          <ThreadPrimitive.ViewportFooter className="assistant-composer-footer">
            {localError && <div className="assistant-inline-error" role="alert"><CircleAlert size={15} /><span>{localError}</span>{retryableSubmission && conversation.status === 'ACTIVE' && !isRunning && <button type="button" className="assistant-inline-retry" onClick={retryFailedSubmission}>使用原请求重试</button>}</div>}
            {canRetryFailedRun && <div className="assistant-inline-error" role="status"><CircleAlert size={15} /><span>本次分析运行失败，可以重新提交原问题并创建一次新运行。</span><button type="button" className="assistant-inline-retry" onClick={retryFailedRun}>重新提交同一问题</button></div>}
            {canReconnectActiveRun && <div className="assistant-inline-error" role="status"><CircleAlert size={15} /><span>页面连接已中断，但服务端任务仍在排队或运行中。</span><button type="button" className="assistant-inline-retry" onClick={() => void reconnectActiveRun()}>重新连接</button></div>}
            {hasActiveRun && <div className="assistant-live-run" role="status"><span className="assistant-live-dot" />{activeRunStatus === 'QUEUED' ? '任务已排队，等待执行' : '正在读取台账并整理分析'}<span> · 可随时取消</span></div>}
            {conversation.status === 'ARCHIVED'
              ? <div className="assistant-archived-note">此会话已归档，只能查看历史内容。</div>
              : <Composer disabled={isRunning} />}
            <p className="assistant-composer-footnote">请核对关键金额与原始台账。助手只读，不执行审批、合同修改或资金操作。</p>
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </div>
  </AssistantRuntimeProvider>;
}

function UserMessage() {
  return <MessagePrimitive.Root className="assistant-message assistant-message-user">
    <div className="assistant-message-role">你</div>
    <div className="assistant-message-content"><MessagePrimitive.Content components={{ Text: AssistantMarkdown }} /></div>
  </MessagePrimitive.Root>;
}

function AssistantMessage() {
  return <MessagePrimitive.Root className="assistant-message assistant-message-agent">
    <div className="assistant-agent-avatar" aria-hidden="true">M</div>
    <div className="assistant-message-body">
      <div className="assistant-message-role">墨衡助手</div>
      <div className="assistant-message-content"><MessagePrimitive.Content components={{ Text: AssistantMarkdown }} /></div>
      <MessagePrimitive.Error>
        <ErrorPrimitive.Root className="assistant-message-error"><CircleAlert size={14} /><ErrorPrimitive.Message /></ErrorPrimitive.Root>
      </MessagePrimitive.Error>
    </div>
  </MessagePrimitive.Root>;
}

function AssistantMarkdown() {
  return <MarkdownTextPrimitive remarkPlugins={[remarkGfm]} className="assistant-markdown" />;
}

function Composer({ disabled }: { disabled: boolean }) {
  const [composing, setComposing] = useState(false);
  return <ComposerPrimitive.Root className={`assistant-composer ${disabled ? 'is-disabled' : ''}`}>
    <div className="assistant-composer-input-wrap" onKeyDownCapture={(event) => {
      const native = event.nativeEvent as KeyboardEvent;
      if (composing || native.isComposing || native.keyCode === 229) event.stopPropagation();
    }}>
      <ComposerPrimitive.Input asChild>
        <textarea
          rows={1}
          maxLength={8000}
          disabled={disabled}
          placeholder="描述你需要核对的成本问题……"
          aria-label="输入成本分析问题"
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onKeyDown={(event) => {
            const native = event.nativeEvent as KeyboardEvent;
            if (composing || native.isComposing || native.keyCode === 229) event.stopPropagation();
          }}
        />
      </ComposerPrimitive.Input>
      <div className="assistant-composer-toolbar">
        <span>Enter 发送 <i /> Shift + Enter 换行</span>
        <AuiIf condition={(state) => !state.thread.isRunning}>
          <ComposerPrimitive.Send className="assistant-send-button" aria-label="发送消息"><ArrowUp size={17} /></ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(state) => state.thread.isRunning}>
          <ComposerPrimitive.Cancel className="assistant-cancel-button" aria-label="取消运行"><Square size={12} fill="currentColor" /></ComposerPrimitive.Cancel>
        </AuiIf>
      </div>
    </div>
  </ComposerPrimitive.Root>;
}
