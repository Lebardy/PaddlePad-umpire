// The player's history as every screen reads it. PlayerDataProvider.jsx
// fetches it and explains why it is fetched once.

import { createContext, useContext } from 'react'

export const PlayerDataContext = createContext(null)

export function usePlayerData() {
  const value = useContext(PlayerDataContext)
  if (!value) throw new Error('usePlayerData must be used inside PlayerDataProvider')
  return value
}
