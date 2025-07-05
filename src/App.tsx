import { useState, useRef, useCallback, useEffect } from 'react'
import { Button } from './components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card'
import { Badge } from './components/ui/badge'
import { ScrollArea } from './components/ui/scroll-area'
import { Separator } from './components/ui/separator'
import { Mic, MicOff, Copy, Trash2, Volume2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'react-hot-toast'
import { blink } from './blink/client'

interface TranscriptChunk {
  id: string
  text: string
  timestamp: number
}

interface VoiceNote {
  id: string
  text: string
  timestamp: number
  duration: number
}

function App() {
  const [isRecording, setIsRecording] = useState(false)
  const [currentTranscript, setCurrentTranscript] = useState('')
  const [transcriptChunks, setTranscriptChunks] = useState<TranscriptChunk[]>([])
  const [voiceNotes, setVoiceNotes] = useState<VoiceNote[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingStartTimeRef = useRef<number>(0)
  const chunkIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const processAudioChunk = useCallback(async (audioBlob: Blob) => {
    try {
      setIsProcessing(true)
      
      // Convert blob to base64 for transcription
      const base64Audio = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = reader.result as string
          const base64Data = dataUrl.split(',')[1]
          resolve(base64Data)
        }
        reader.onerror = reject
        reader.readAsDataURL(audioBlob)
      })

      // Transcribe the audio chunk
      const { text } = await blink.ai.transcribeAudio({
        audio: base64Audio,
        language: 'en'
      })

      if (text.trim()) {
        const chunkId = Date.now().toString()
        const newChunk: TranscriptChunk = {
          id: chunkId,
          text: text.trim(),
          timestamp: Date.now()
        }

        setTranscriptChunks(prev => [...prev, newChunk])

        // Use AI to combine and improve the transcript
        const allChunks = [...transcriptChunks, newChunk]
        if (allChunks.length > 0) {
          const combinedText = allChunks.map(chunk => chunk.text).join(' ')
          
          const { text: improvedText } = await blink.ai.generateText({
            prompt: `Please clean up and improve this transcribed text by making it more coherent and fixing any transcription errors. Keep the meaning intact but make it flow naturally as a single piece of text. Do not add any commentary, just return the improved text:

"${combinedText}"`,
            maxTokens: 500
          })

          setCurrentTranscript(improvedText.trim())
        }
      }
    } catch (error) {
      console.error('Error processing audio chunk:', error)
    } finally {
      setIsProcessing(false)
    }
  }, [transcriptChunks])

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      })

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm'
      })

      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []
      setTranscriptChunks([])
      setCurrentTranscript('')
      recordingStartTimeRef.current = Date.now()
      setRecordingDuration(0)

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = async () => {
        if (audioChunksRef.current.length > 0) {
          const finalBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
          await processAudioChunk(finalBlob)
        }
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop())
      }

      mediaRecorder.start()
      setIsRecording(true)

      // Process chunks every 5 seconds
      chunkIntervalRef.current = setInterval(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop()
          
          setTimeout(() => {
            if (audioChunksRef.current.length > 0) {
              const chunkBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
              processAudioChunk(chunkBlob)
              audioChunksRef.current = []
            }
            
            if (isRecording) {
              mediaRecorderRef.current?.start()
            }
          }, 100)
        }
      }, 5000)

      // Update duration every second
      durationIntervalRef.current = setInterval(() => {
        setRecordingDuration(Math.floor((Date.now() - recordingStartTimeRef.current) / 1000))
      }, 1000)

      toast.success('Recording started!')
    } catch (error) {
      console.error('Error starting recording:', error)
      toast.error('Failed to start recording. Please check microphone permissions.')
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
    }

    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current)
    }

    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current)
    }

    setIsRecording(false)

    // Save the final transcript as a voice note
    if (currentTranscript.trim()) {
      const duration = Math.floor((Date.now() - recordingStartTimeRef.current) / 1000)
      const newNote: VoiceNote = {
        id: Date.now().toString(),
        text: currentTranscript.trim(),
        timestamp: Date.now(),
        duration
      }
      setVoiceNotes(prev => [newNote, ...prev])
      toast.success('Voice note saved!')
    }
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied to clipboard!')
    } catch {
      toast.error('Failed to copy to clipboard')
    }
  }

  const deleteNote = (id: string) => {
    setVoiceNotes(prev => prev.filter(note => note.id !== id))
    toast.success('Note deleted')
  }

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString()
  }

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      if (chunkIntervalRef.current) clearInterval(chunkIntervalRef.current)
      if (durationIntervalRef.current) clearInterval(durationIntervalRef.current)
      if (mediaRecorderRef.current) mediaRecorderRef.current.stop()
    }
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold text-slate-800 flex items-center justify-center gap-3">
            <Volume2 className="h-8 w-8 text-blue-600" />
            AI Voice Notes
          </h1>
          <p className="text-slate-600">Real-time speech transcription with AI enhancement</p>
        </div>

        {/* Recording Interface */}
        <Card className="bg-white/80 backdrop-blur-sm border-slate-200 shadow-lg">
          <CardHeader className="text-center">
            <CardTitle className="text-xl text-slate-800">Voice Recording</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Record Button */}
            <div className="flex justify-center">
              <motion.div
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Button
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={isProcessing}
                  size="lg"
                  className={`w-24 h-24 rounded-full transition-all duration-300 ${
                    isRecording 
                      ? 'bg-red-500 hover:bg-red-600 shadow-lg shadow-red-200' 
                      : 'bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-200'
                  }`}
                >
                  <motion.div
                    animate={isRecording ? { scale: [1, 1.2, 1] } : {}}
                    transition={{ repeat: Infinity, duration: 1.5 }}
                  >
                    {isRecording ? (
                      <MicOff className="h-8 w-8" />
                    ) : (
                      <Mic className="h-8 w-8" />
                    )}
                  </motion.div>
                </Button>
              </motion.div>
            </div>

            {/* Recording Status */}
            <AnimatePresence>
              {isRecording && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="text-center space-y-2"
                >
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                    <span className="text-red-600 font-medium">Recording</span>
                    <Badge variant="secondary">{formatDuration(recordingDuration)}</Badge>
                  </div>
                  {isProcessing && (
                    <p className="text-slate-500 text-sm">Processing audio chunk...</p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Current Transcript */}
            {currentTranscript && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="space-y-3"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-slate-800">Live Transcript</h3>
                  <Button
                    onClick={() => copyToClipboard(currentTranscript)}
                    variant="outline"
                    size="sm"
                    className="gap-2"
                  >
                    <Copy className="h-4 w-4" />
                    Copy
                  </Button>
                </div>
                <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                  <p className="text-slate-700 leading-relaxed">{currentTranscript}</p>
                </div>
              </motion.div>
            )}
          </CardContent>
        </Card>

        {/* Voice Notes History */}
        {voiceNotes.length > 0 && (
          <Card className="bg-white/80 backdrop-blur-sm border-slate-200 shadow-lg">
            <CardHeader>
              <CardTitle className="text-xl text-slate-800">Voice Notes History</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px] pr-4">
                <div className="space-y-4">
                  {voiceNotes.map((note, index) => (
                    <motion.div
                      key={note.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className="group"
                    >
                      <div className="bg-slate-50 rounded-lg p-4 border border-slate-200 hover:border-slate-300 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center gap-2 text-sm text-slate-600">
                              <span>{formatTimestamp(note.timestamp)}</span>
                              <Badge variant="outline">{formatDuration(note.duration)}</Badge>
                            </div>
                            <p className="text-slate-700 leading-relaxed">{note.text}</p>
                          </div>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                              onClick={() => copyToClipboard(note.text)}
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                            <Button
                              onClick={() => deleteNote(note.id)}
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                      {index < voiceNotes.length - 1 && <Separator className="mt-4" />}
                    </motion.div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        {/* Instructions */}
        <Card className="bg-blue-50/50 border-blue-200">
          <CardContent className="pt-6">
            <div className="text-center space-y-2">
              <h3 className="font-medium text-blue-800">How it works</h3>
              <p className="text-blue-700 text-sm">
                Click the microphone to start recording. Your speech will be transcribed in real-time 
                with AI enhancement every 5 seconds for maximum accuracy. Stop recording to save your note.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default App