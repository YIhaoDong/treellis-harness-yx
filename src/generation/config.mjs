export const MODEL_ID = 'gpt-6.1-sol'
export const MODEL_FAMILY_LABEL = 'GPT-6.1'
export const DEFAULT_RUN_MODE = 'medium'
export const RUN_MODES = Object.fromEntries(['low', 'medium', 'high', 'xhigh', 'max'].map((effort) => [effort, {
  label: effort === 'xhigh' ? 'XHigh' : effort[0].toUpperCase() + effort.slice(1), reasoningEffort: effort,
}]))
export const ASSET_NAMES = ['role_global', 'task_global_create', 'task_global_edit', 'role_node',
  'task_node_edit', 'jsonFormat', 'jsonCase', 'constraints_global', 'constraints_node',
  'nodeAdjustRules', 'parameterRules', 'colorRules', 'runtime_rules']
