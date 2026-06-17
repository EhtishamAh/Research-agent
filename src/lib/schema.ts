import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

export const GraphState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  clarity_status: Annotation<"clear" | "needs_clarification" | null>({
    reducer: (state, update) => update ?? state,
    default: () => null,
  }),
  confidence_score: Annotation<number>({
    reducer: (state, update) => update ?? state,
    default: () => 0,
  }),
  validation_result: Annotation<"sufficient" | "insufficient" | null>({
    reducer: (state, update) => update ?? state,
    default: () => null,
  }),
  attempts: Annotation<number>({
    reducer: (state, update) => (update === 0 ? 0 : state + update),
    default: () => 0,
  }),
  context_data: Annotation<string>({
    reducer: (state, update) => (update ? state + "\n\n" + update : state),
    default: () => "",
  }),
});

export type AgentState = typeof GraphState.State;