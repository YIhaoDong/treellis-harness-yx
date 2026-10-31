import initialScene from './scene.json'

export const createInitialScene = () => JSON.parse(JSON.stringify(initialScene.scene || initialScene))
