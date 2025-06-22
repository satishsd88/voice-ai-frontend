import React, { useState, useRef, useEffect } from 'react';

// Main App component
const App = () => {
    // State variables for UI and application logic
    const [isRecording, setIsRecording] = useState(false); // Tracks if audio recording is active
    const [audioChunks, setAudioChunks] = useState([]); // Stores recorded audio data chunks
    const [transcribedText, setTranscribedText] = useState(''); // Stores text transcribed by STT service
    const [refinedQuestion, setRefinedQuestion] = useState(''); // Stores the question refined by Gemini
    const [aiAnswer, setAiAnswer] = useState(''); // Stores AI's generated answer
    const [statusMessage, setStatusMessage] = useState('Click "Start Recording" to begin capturing tab audio.'); // User feedback message
    const [isLoading, setIsLoading] = useState(false); // General loading indicator for API calls
    const [isRefining, setIsRefining] = useState(false); // Loading indicator for Gemini refinement

    // Refs for MediaRecorder and audio stream
    const mediaRecorderRef = useRef(null);
    const audioStreamRef = useRef(null);

    // IMPORTANT: Define your backend URL here.
    // This MUST match the public URL of your deployed Node.js backend on Render.com.
    const BACKEND_URL = 'https://voice-ai-backend-euw9.onrender.com'; // REPLACE WITH YOUR RENDER.COM BACKEND URL

    // --- Media Capture Functions ---

    // Effect hook to request display media (tab/window audio) access on component mount
    useEffect(() => {
        const getDisplayMediaAudio = async () => {
            // Removed 'if (!user)' check as authentication is no longer active
            try {
                // Request access to display media (specifically audio from a tab/window).
                // This will prompt the user to select a screen, window, or browser tab to share.
                // It's crucial that 'Share audio' checkbox is enabled in the browser's prompt.
                // NOTE: This will only work if your app is run as a top-level website (not in an iframe)
                const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: false });
                audioStreamRef.current = stream; // Store the stream for later use
                setStatusMessage('Tab/Window audio capture ready. Select a tab/window to share its its audio.');
            } catch (err) {
                console.error('Error accessing display media for audio:', err);
                if (err.name === 'NotAllowedError' && err.message.includes('permissions policy')) {
                    setStatusMessage('Tab/Window audio capture is blocked by browser permissions policy. Try running this app in a standalone browser tab.');
                } else if (err.name === 'NotAllowedError') {
                    setStatusMessage('Tab/Window audio capture denied. Please allow access in browser settings (click lock icon in address bar).');
                } else if (err.name === 'NotFoundError') {
                    setStatusMessage('No suitable audio source found. Ensure a tab/window is available for capture.');
                } else {
                    setStatusMessage('Failed to get audio stream. See browser console (F12) for details.');
                }
            }
        };

        getDisplayMediaAudio(); // Request media access on component mount

        // Cleanup function: stop audio tracks when component unmounts
        return () => {
            if (audioStreamRef.current) {
                audioStreamRef.current.getTracks().forEach(track => track.stop());
                audioStreamRef.current = null; // Ensure ref is cleared
            }
        };
    }, []); // Empty dependency array: runs once on mount, as there's no 'user' state to trigger re-runs

    // Function to start audio recording
    const startRecording = async () => {
        // Removed 'if (!user)' check as authentication is no longer active
        if (!audioStreamRef.current) {
            setStatusMessage('Audio stream not available. Attempting to re-acquire...');
            // Attempt to re-request media stream if it's somehow lost after initial load
            try {
                const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: false });
                audioStreamRef.current = stream;
                if (!audioStreamRef.current) { // Check again if stream was successfully acquired
                    setStatusMessage("Cannot start recording: Still no audio stream available after re-attempt. Check browser permissions.");
                    return;
                }
            } catch (err) {
                console.error("Failed to re-acquire stream:", err);
                setStatusMessage("Cannot start recording: Failed to acquire audio stream. Check browser console.");
                return;
            }
        }

        setAudioChunks([]); // Clear previous audio chunks
        setTranscribedText(''); // Clear previous transcription
        setRefinedQuestion(''); // Clear previous refined question
        setAiAnswer(''); // Clear previous AI answer
        setIsRecording(true); // Set recording status to true
        setStatusMessage('Recording tab/window audio...');
        setIsLoading(false); // Ensure loading is off when starting new recording

        try {
            // Create a new MediaRecorder instance with the audio stream
            mediaRecorderRef.current = new MediaRecorder(audioStreamRef.current);

            // Event handler for when data is available (audio chunks)
            mediaRecorderRef.current.ondataavailable = (event) => {
                // If there's valid audio data, add it to the chunks array
                if (event.data.size > 0) {
                    setAudioChunks((prev) => [...prev, event.data]);
                }
            };

            // Event handler for when recording stops
            mediaRecorderRef.current.onstop = () => {
                // After stopping, process the collected audio
                sendAudioForProcessing();
            };

            // Start recording, collecting data in 1-second chunks
            mediaRecorderRef.current.start(1000); // Collect data every 1000ms (1 second)
        } catch (error) {
            console.error('Error starting recording:', error);
            setStatusMessage('Error starting recording. Ensure a tab is selected for audio sharing.');
            setIsRecording(false);
        }
    };

    // Function to stop audio recording
    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop(); // Stop the MediaRecorder
            setIsRecording(false); // Set recording status to false
            setStatusMessage('Processing tab audio...');
            setIsLoading(true); // Show loading indicator
        }
    };

    // --- Backend API Call Functions ---

    // Function to send recorded audio for processing (STT and OpenAI)
    const sendAudioForProcessing = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' }); // Common format for WebM

        if (audioBlob.size === 0) {
            setStatusMessage('No audio recorded from the tab. Please ensure audio is playing and you record for a sufficient duration.');
            setIsLoading(false);
            return;
        }

        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm'); // 'audio' is the field name on the backend

        try {
            // --- STEP 1: Sending audio to STT service via backend proxy ---
            setStatusMessage('Sending tab audio for transcription...');
            const sttResponse = await fetch(`${BACKEND_URL}/api/stt`, {
                method: 'POST',
                body: formData,
            });

            if (!sttResponse.ok) {
                const errorData = await sttResponse.json().catch(() => ({ message: sttResponse.statusText }));
                throw new Error(`STT API error: ${sttResponse.status} - ${errorData.message || sttResponse.statusText}`);
            }

            const sttResult = await sttResponse.json();
            const transcription = sttResult.transcription || 'No transcription received.';
            setTranscribedText(transcription);
            setStatusMessage('Transcription received. You can now refine it or get an AI answer.');

        } catch (error) {
            console.error('Error during processing (STT):', error);
            if (error.message.includes('Failed to fetch')) {
                setStatusMessage(`Error: Could not connect to backend. Ensure backend is running at ${BACKEND_URL} and check CORS.`);
            } else {
                setStatusMessage(`Error during transcription: ${error.message}. Please try again.`);
            }
        } finally {
            setIsLoading(false); // Hide loading indicator
            setAudioChunks([]); // Clear chunks after processing
        }
    };

    // Function to send question to OpenAI API (can use original or refined question)
    const getAiAnswer = async () => {
        const questionToSend = refinedQuestion || transcribedText; // Use refined question if available

        if (!questionToSend) {
            setStatusMessage('Please transcribe audio or refine a question first.');
            return;
        }

        setIsLoading(true);
        setStatusMessage('Sending question to AI...');
        setAiAnswer(''); // Clear previous answer

        try {
            const openaiResponse = await fetch(`${BACKEND_URL}/api/openai`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ question: questionToSend }),
            });

            if (!openaiResponse.ok) {
                const errorData = await openaiResponse.json().catch(() => ({ message: openaiResponse.statusText }));
                throw new Error(`OpenAI API error: ${openaiResponse.status} - ${errorData.message || openaiResponse.statusText}`);
            }

            const openaiResult = await openaiResponse.json();
            const answer = openaiResult.answer || 'No answer received from AI.';
            setAiAnswer(answer);
            setStatusMessage('AI Answer received!');

        } catch (error) {
            console.error('Error during processing (OpenAI):', error);
            setStatusMessage(`Error getting AI answer: ${error.message}. Please try again.`);
        } finally {
            setIsLoading(false); // Hide loading indicator
        }
    };


    // --- Gemini API Call for Question Refinement ---
    const handleRefineQuestion = async () => {
        if (!transcribedText) {
            setStatusMessage('Please transcribe audio first to refine a question.');
            return;
        }
        setIsRefining(true);
        setStatusMessage('Refining question with Gemini...');
        setRefinedQuestion(''); // Clear previous refined question

        try {
            // Note: In this environment, the apiKey is automatically provided by Canvas at runtime.
            // For a real production app, you might proxy this through your backend for security.
            const apiKey = ""; // API key is automatically provided by Canvas at runtime.
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
            
            const chatHistory = [];
            chatHistory.push({ 
                role: "user", 
                parts: [{ text: `Refine the following question to be more clear, concise, and suitable for an AI assistant. Focus on making it a direct query. Do not add any conversational filler. Just the refined question:\n\n"${transcribedText}"` }] 
            });
            const payload = { contents: chatHistory };

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: response.statusText }));
                throw new Error(`Gemini API error: ${response.status} - ${errorData.message || response.statusText}`);
            }

            const result = await response.json();
            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                const text = result.candidates[0].content.parts[0].text;
                setRefinedQuestion(text);
                setStatusMessage('Question refined by Gemini! You can now get an AI answer.');
            } else {
                setStatusMessage('Gemini did not return a valid refinement. Try again.');
            }

        } catch (error) {
            console.error('Error refining question with Gemini:', error);
            setStatusMessage(`Error refining question: ${error.message}.`);
        } finally {
            setIsRefining(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-800 to-indigo-900 text-white flex items-center justify-center p-4 font-inter">
            <div className="bg-gray-800 bg-opacity-70 backdrop-blur-md rounded-2xl shadow-xl p-8 max-w-2xl w-full border border-purple-600">
                <h1 className="text-4xl font-bold text-center mb-6 text-purple-300">
                    Voice AI Assistant
                </h1>

                {/* Status Message */}
                <p className="text-center text-lg mb-6 text-gray-300">{statusMessage}</p>

                {/* Control Buttons */}
                <div className="flex justify-center gap-4 mb-8">
                    <button
                        onClick={startRecording}
                        disabled={isRecording || isLoading}
                        className={`px-8 py-3 rounded-full text-lg font-semibold transition duration-300 ease-in-out transform
                            ${(isRecording || isLoading) ? 'bg-gray-600 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700 active:scale-95 shadow-lg hover:shadow-xl'}
                            focus:outline-none focus:ring-4 focus:ring-green-500 focus:ring-opacity-50`}
                    >
                        {isRecording ? 'Recording...' : 'Start Recording'}
                    </button>
                    <button
                        onClick={stopRecording}
                        disabled={!isRecording || isLoading}
                        className={`px-8 py-3 rounded-full text-lg font-semibold transition duration-300 ease-in-out transform
                            ${(!isRecording || isLoading) ? 'bg-gray-600 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700 active:scale-95 shadow-lg hover:shadow-xl'}
                            focus:outline-none focus:ring-4 focus:ring-red-500 focus:ring-opacity-50`}
                    >
                        Stop Recording
                    </button>
                </div>

                {/* Loading Spinner */}
                {(isLoading || isRefining) && ( // Combined loading for both main API and refinement
                    <div className="flex justify-center mb-8">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-purple-500"></div>
                    </div>
                )}

                {/* Transcribed Text Display */}
                <div className="mb-4 p-4 bg-gray-700 rounded-lg border border-gray-600 shadow-inner">
                    <h2 className="text-xl font-semibold mb-3 text-purple-400">Your Question (Transcription):</h2>
                    <p className="text-gray-200 text-base min-h-[60px] italic">
                        {transcribedText || 'Audio from the selected tab/window will be transcribed here.'}
                    </p>
                    {transcribedText && (
                        <div className="flex justify-center mt-4">
                            <button
                                onClick={handleRefineQuestion}
                                disabled={isRefining || isLoading}
                                className={`px-6 py-2 rounded-full text-md font-semibold transition duration-300 ease-in-out transform
                                    ${(isRefining || isLoading) ? 'bg-gray-600 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 active:scale-95 shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500'}
                                `}
                            >
                                {isRefining ? 'Refining...' : '✨ Refine Question'}
                            </button>
                        </div>
                    )}
                </div>

                {/* Refined Question Display (New Section for Gemini Output) */}
                {refinedQuestion && (
                    <div className="mb-8 p-4 bg-gray-700 rounded-lg border border-gray-600 shadow-inner">
                        <h2 className="text-xl font-semibold mb-3 text-emerald-400">Refined Question:</h2>
                        <p className="text-gray-200 text-base min-h-[60px]">{refinedQuestion}</p>
                    </div>
                )}

                {/* Get AI Answer Button */}
                {(transcribedText || refinedQuestion) && (
                     <div className="flex justify-center mb-8">
                        <button
                            onClick={getAiAnswer}
                            disabled={isLoading || isRefining}
                            className={`px-8 py-3 rounded-full text-lg font-semibold transition duration-300 ease-in-out transform
                                ${(isLoading || isRefining) ? 'bg-gray-600 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 active:scale-95 shadow-lg hover:shadow-xl'}
                                focus:outline-none focus:ring-4 focus:ring-indigo-500 focus:ring-opacity-50`}
                        >
                            Get AI Answer
                        </button>
                    </div>
                )}

                {/* AI Answer Display */}
                <div className="p-4 bg-gray-700 rounded-lg border border-gray-600 shadow-inner">
                    <h2 className="text-xl font-semibold mb-3 text-purple-400">AI's Answer:</h2>
                    <p className="text-gray-200 text-base min-h-[100px]">
                        {aiAnswer || 'The AI\'s response will appear here after processing the tab/window audio.'}
                    </p>
                </div>
            </div>
        </div>
    );
};

export default App;
