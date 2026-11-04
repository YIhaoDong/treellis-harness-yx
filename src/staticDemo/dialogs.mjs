// The static demo used to carry its own text dialog; it now shares the app's.
import { askText, dismissDialog } from '../ui/dialogs.mjs'

export function dismissStaticDialog() {
  dismissDialog()
}

export function requestStaticText(title, initialValue = '') {
  return askText({ title, value: initialValue })
}
