import { createContext, useContext, type Dispatch } from 'react'
import type { EditSession, SessionAction } from '../session/editState.ts'

/** 編集中の状態と、その操作。App が useReducer で持ち、下の部品はここから読む */
export interface EditSessionStore {
  session: EditSession
  dispatch: Dispatch<SessionAction>
}

export const EditSessionContext = createContext<EditSessionStore | null>(null)

export function useEditSession(): EditSessionStore {
  const store = useContext(EditSessionContext)
  if (!store) throw new Error('EditSessionContext の外で使われた')
  return store
}
