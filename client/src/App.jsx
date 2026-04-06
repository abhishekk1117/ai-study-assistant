import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import ReactMarkdown from 'react-markdown'
import './App.css'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'
const STORAGE_KEYS = {
  messages: 'aiStudyAssistant.messages',
  uploadState: 'aiStudyAssistant.uploadState',
  hasIndexed: 'aiStudyAssistant.hasIndexed',
}

function App() {
  const [selectedFile, setSelectedFile] = useState(null)
  const [uploadState, setUploadState] = useState({ message: '', error: '' })
  const [question, setQuestion] = useState('')
  const [debouncedQuestion, setDebouncedQuestion] = useState('')
  const [messages, setMessages] = useState([])
  const [isAsking, setIsAsking] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [hasIndexedMaterial, setHasIndexedMaterial] = useState(false)
  const [lastQuestion, setLastQuestion] = useState('')
  const messagesEndRef = useRef(null)

  const examplePrompts = [
    'Summarize this PDF in simple points',
    'Explain chapter 2 in easy words',
    'Give me key points for revision',
  ]

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedQuestion(question)
    }, 300)

    return () => clearTimeout(timeout)
  }, [question])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, isAsking])

  useEffect(() => {
    try {
      const savedMessages = localStorage.getItem(STORAGE_KEYS.messages)
      const savedUploadState = localStorage.getItem(STORAGE_KEYS.uploadState)
      const savedHasIndexed = localStorage.getItem(STORAGE_KEYS.hasIndexed)

      if (savedMessages) {
        setMessages(JSON.parse(savedMessages))
      }
      if (savedUploadState) {
        setUploadState(JSON.parse(savedUploadState))
      }
      if (savedHasIndexed) {
        setHasIndexedMaterial(savedHasIndexed === 'true')
      }
    } catch {
      localStorage.removeItem(STORAGE_KEYS.messages)
      localStorage.removeItem(STORAGE_KEYS.uploadState)
      localStorage.removeItem(STORAGE_KEYS.hasIndexed)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.messages, JSON.stringify(messages))
  }, [messages])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.uploadState, JSON.stringify(uploadState))
  }, [uploadState])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.hasIndexed, String(hasIndexedMaterial))
  }, [hasIndexedMaterial])

  const canAsk = hasIndexedMaterial && debouncedQuestion.trim().length > 0 && !isAsking

  async function handleUpload() {
    if (!selectedFile) {
      setUploadState({ message: '', error: 'Please choose a PDF file first.' })
      return
    }

    if (selectedFile.type !== 'application/pdf') {
      setUploadState({ message: '', error: 'Only PDF files are supported.' })
      return
    }

    const formData = new FormData()
    formData.append('file', selectedFile)
    setIsUploading(true)

    try {
      setUploadState({ message: 'Uploading and indexing...', error: '' })
      const response = await axios.post(`${API_BASE_URL}/upload`, formData)
      setUploadState({
        message: `File processed and indexed successfully. Added ${response.data.chunksAdded} chunks.`,
        error: '',
      })
      setHasIndexedMaterial(true)
    } catch (error) {
      setUploadState({
        message: '',
        error: error.response?.data?.error || 'Upload failed.',
      })
    } finally {
      setIsUploading(false)
    }
  }

  async function submitQuestion(questionText) {
    const nextQuestion = questionText.trim()

    if (!hasIndexedMaterial) {
      setUploadState({
        message: '',
        error: 'Please upload a PDF first.',
      })
      return
    }

    if (!nextQuestion || isAsking) {
      return
    }

    const userMessage = { role: 'user', text: nextQuestion }
    setMessages((prev) => [...prev, userMessage])
    setLastQuestion(nextQuestion)
    setQuestion('')
    setIsAsking(true)

    try {
      const response = await axios.post(`${API_BASE_URL}/chat`, {
        question: nextQuestion,
      })

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: response.data.answer,
          notice: response.data.notice || '',
          sources: response.data.sources || [],
          canRetry: false,
        },
      ])
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text:
            error.response?.data?.error ||
            'Something went wrong while generating an answer.',
          notice: '',
          sources: [],
          canRetry: true,
          retryLabel: 'Retry answer',
        },
      ])
    } finally {
      setIsAsking(false)
    }
  }

  async function handleAsk(event) {
    event.preventDefault()
    await submitQuestion(question)
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleAsk(event)
    }
  }

  function parseAnswerSections(text) {
    const lines = text.split('\n')
    const sections = []
    let currentSection = { type: 'text', content: '' }

    for (const line of lines) {
      if (line.startsWith('Answer:')) {
        if (currentSection.content.trim()) sections.push(currentSection)
        currentSection = { type: 'answer', content: line.replace('Answer:', '').trim() }
        continue
      }
      if (line.startsWith('Insight:')) {
        if (currentSection.content.trim()) sections.push(currentSection)
        currentSection = { type: 'insight', content: line.replace('Insight:', '').trim() }
        continue
      }
      if (line.startsWith('Takeaway:')) {
        if (currentSection.content.trim()) sections.push(currentSection)
        currentSection = { type: 'takeaway', content: line.replace('Takeaway:', '').trim() }
        continue
      }
      if (line.startsWith('Why this answer:')) {
        if (currentSection.content.trim()) sections.push(currentSection)
        currentSection = { type: 'why', content: line.replace('Why this answer:', '').trim() }
        continue
      }

      currentSection.content += `${currentSection.content ? '\n' : ''}${line}`
    }

    if (currentSection.content.trim()) sections.push(currentSection)
    return sections.length ? sections : [{ type: 'text', content: text }]
  }

  function renderAnswerContent(text) {
    return parseAnswerSections(text).map((section, idx) => (
      <div key={`${section.type}-${idx}`} className={`section ${section.type}`}>
        {section.type !== 'text' ? <strong>{section.type[0].toUpperCase() + section.type.slice(1)}:</strong> : null}
        <ReactMarkdown>{section.content}</ReactMarkdown>
      </div>
    ))
  }

  function clearChat() {
    if (messages.length === 0) return

    if (!window.confirm('Are you sure you want to clear the chat?')) {
      return
    }

    setMessages([])
    localStorage.removeItem(STORAGE_KEYS.messages)
  }

  function handlePromptClick(promptText) {
    setQuestion(promptText)
  }

  function retryLastQuestion() {
    if (!lastQuestion) return
    setQuestion(lastQuestion)
  }

  function renderSystemStatus() {
    if (isUploading) {
      return <span className="status-pill indexing">Indexing your PDF...</span>
    }
    if (hasIndexedMaterial) {
      return <span className="status-pill ready">Notes ready</span>
    }
    return <span className="status-pill waiting">Waiting for notes</span>
  }

  function renderUploadFeedback() {
    if (isUploading) {
      return <p className="upload-feedback indexing">⏳ Indexing your notes...</p>
    }
    if (uploadState.error) {
      return (
        <div className="upload-feedback error-box">
          <p>❌ Upload failed. {uploadState.error}</p>
          <button
            type="button"
            className="retry-btn"
            onClick={() => setUploadState({ message: '', error: '' })}
          >
            Try Again
          </button>
        </div>
      )
    }
    if (hasIndexedMaterial) {
      return <p className="upload-feedback success">✅ Notes ready! Start asking questions below.</p>
    }
    return null
  }

  async function sendPrompt(promptText) {
    setQuestion(promptText)
    setDebouncedQuestion(promptText)
    await submitQuestion(promptText)
  }

  function getStepClasses() {
    if (isUploading) {
      return ['step-done', 'step-active', 'step-pending']
    }

    if (hasIndexedMaterial) {
      return ['step-done', 'step-done', 'step-active']
    }

    return ['step-active', 'step-pending', 'step-pending']
  }

  const [uploadStepClass, indexingStepClass, questionStepClass] = getStepClasses()

  return (
    <div className="app-shell">
      <header className="hero-panel">
        <p className="badge">RAG Study Companion</p>
        <h1>Chat with your notes</h1>
        <p className="hero-value">Turn your notes into instant answers and save hours of studying.</p>
        <p>
          Hi! Upload your notes and I will help you study with answers based on your own material.
        </p>

        <div className="step-guide">
          <span className={uploadStepClass}>
            {hasIndexedMaterial ? '✅' : '📤'} Upload notes
          </span>
          <span className={indexingStepClass}>
            {isUploading ? '⏳' : hasIndexedMaterial ? '✅' : '🔎'} Wait for indexing
          </span>
          <span className={questionStepClass}>
            {hasIndexedMaterial ? '💬' : '❓'} Ask questions
          </span>
        </div>
      </header>

      <section className="upload-panel">
        <div className="panel-header-row">
          <h2>Upload Your Notes</h2>
          <div className="status-cluster">
            {hasIndexedMaterial ? <span className="ready-badge">Ready to Chat</span> : null}
            {renderSystemStatus()}
          </div>
        </div>
        <div className="upload-controls">
          <input
            type="file"
            accept="application/pdf"
            disabled={isUploading}
            onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
          />
          <button onClick={handleUpload} disabled={isUploading}>
            {isUploading ? 'Uploading...' : 'Upload + Index'}
          </button>
        </div>
        {selectedFile ? (
          <div className="file-preview">
            <span className="file-preview-label">Uploaded file</span>
            <span className="file-preview-name">{selectedFile.name}</span>
          </div>
        ) : null}
        {renderUploadFeedback()}
        {uploadState.message ? (
          <p className="status success">{uploadState.message}</p>
        ) : null}
        {uploadState.error ? <p className="status error">{uploadState.error}</p> : null}
      </section>

      <section className="chat-panel">
        <div className="panel-header-row">
          <h2>Chat with your notes</h2>
          <div className="status-cluster">
            <span className="notes-badge">Answering from your notes</span>
            {messages.length ? (
              <button className="clear-btn" onClick={clearChat} type="button">
                Clear Chat
              </button>
            ) : null}
          </div>
        </div>

        <div className="prompt-row">
          {examplePrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="prompt-chip"
              onClick={() => sendPrompt(prompt)}
            >
              {prompt}
            </button>
          ))}
        </div>

        <div className="messages">
          {messages.length === 0 ? (
            <div className="empty-state">
              <p className="empty-icon">📄</p>
              <p className="empty-title">
                {hasIndexedMaterial ? 'Your study assistant is ready!' : 'No notes uploaded yet'}
              </p>
              <p>
                {hasIndexedMaterial
                  ? 'Notes are indexed. Ask your first question below.'
                  : 'Upload a PDF first, then ask your first question.'}
              </p>
            </div>
          ) : (
            messages.map((message, idx) => (
              <article key={`${message.role}-${idx}`} className={`bubble ${message.role}`}>
                {message.role === 'assistant' ? (
                  <div className="assistant-content">{renderAnswerContent(message.text)}</div>
                ) : (
                  <p>{message.text}</p>
                )}
                {message.role === 'assistant' && message.canRetry ? (
                  <button type="button" className="retry-btn inline" onClick={retryLastQuestion}>
                    {message.retryLabel || 'Retry'}
                  </button>
                ) : null}
                {message.role === 'assistant' && message.notice ? (
                  <div className="assistant-notice">{message.notice}</div>
                ) : null}
                {message.role === 'assistant' && message.sources?.length ? (
                  <div className="sources-wrap">
                    <hr className="sources-divider" />
                    <small className="sources">
                      Sources:{' '}
                      {message.sources.map((source, sourceIdx) => (
                        <span key={`${source.source}-${source.chunk}-${sourceIdx}`} className="source-item">
                          <a
                            href="#"
                            onClick={(event) => event.preventDefault()}
                            className="source-link"
                          >
                            {source.source}#{source.chunk}
                          </a>
                          {source.excerpt ? (
                            <span className="source-excerpt">"{source.excerpt}"</span>
                          ) : null}
                        </span>
                      ))}
                    </small>
                  </div>
                ) : null}
              </article>
            ))
          )}

          {isAsking ? (
            <article className="bubble assistant typing-bubble">
              <span className="typing-dot"></span>
              <span className="typing-dot"></span>
              <span className="typing-dot"></span>
            </article>
          ) : null}
          <div ref={messagesEndRef} />
        </div>
        {messages.length > 5 ? (
          <button
            type="button"
            className="scroll-bottom-btn"
            onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })}
          >
            ⬇️ Latest
          </button>
        ) : null}
        <form className="ask-form" onSubmit={handleAsk}>
          <input
            type="text"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!hasIndexedMaterial}
            placeholder={
              hasIndexedMaterial
                ? 'Ask from your uploaded notes...'
                : 'Upload a PDF first, then ask questions...'
            }
          />
          <button type="submit" disabled={!canAsk}>
            {isAsking ? 'Thinking...' : 'Send'}
          </button>
        </form>
        {question.length > 500 ? (
          <small className="char-warning">Question is too long ({question.length} / 500 chars)</small>
        ) : null}
        {isAsking ? (
          <div className="loading-row">
            <div className="loader" aria-label="Loading"></div>
            <span>Searching your notes...</span>
          </div>
        ) : null}
      </section>

      <footer className="footer-note">
        Retrieval-Augmented Generation: answers are grounded in your uploaded content.
      </footer>
    </div>
  )
}

export default App
