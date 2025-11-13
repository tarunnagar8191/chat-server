const {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} = require("@aws-sdk/client-s3");
const antMediaService = require("./antMediaService");
const Call = require("../models/Call");

/**
 * Recording Service
 * Handles call recording upload to S3 and metadata management
 */
class RecordingService {
  constructor() {
    // Initialize S3 client
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });

    this.bucketName = process.env.AWS_S3_BUCKET;
    
    console.log(`📦 Recording Service initialized with S3 bucket: ${this.bucketName}`);
  }

  /**
   * Start call recording
   * Creates ANT Media stream with MP4 recording enabled
   * @param {string} callId - Call ID
   * @param {object} callData - Call metadata (fromUserId, toUserId, callType, etc.)
   * @returns {Promise<string>} Stream ID
   */
  async startCallRecording(callId, callData) {
    try {
      console.log(`🎬 Starting call recording for call: ${callId}`);
      
      const streamId = `call_${callId}`;
      const streamName = `Call_${callData.callType}_${callData.fromUserId}_to_${callData.toUserId}`;

      // Try to create stream via REST API with MP4 recording enabled
      // This ensures recording is enabled even if dashboard setting is off
      try {
        await antMediaService.createStream(streamId, streamName);
        console.log(`✅ Stream pre-created with recording enabled: ${streamId}`);
      } catch (createError) {
        // If REST API doesn't work, stream will be auto-created by WebRTC
        console.log(`ℹ️  Stream will be auto-created by WebRTC: ${streamId}`);
      }
      
      // Update call record with stream information
      await Call.findOneAndUpdate(
        { callId },
        {
          antMediaStreamId: streamId,
          recordingStatus: "recording",
        }
      );

      console.log(`✅ Call recording prepared for call: ${callId}`);
      return streamId;
    } catch (error) {
      console.error(`❌ Error starting call recording for ${callId}:`, error.message);
      
      // Update call with error status
      await Call.findOneAndUpdate(
        { callId },
        {
          recordingStatus: "failed",
          recordingError: error.message,
        }
      );
      
      throw error;
    }
  }

  /**
   * Stop call recording and upload to S3
   * @param {string} callId - Call ID
   * @returns {Promise<object>} Recording details (S3 URL, file size, etc.)
   */
  async stopCallRecording(callId) {
    try {
      console.log(`🛑 Stopping call recording for call: ${callId}`);
      
      const call = await Call.findOne({ callId });
      
      if (!call || !call.antMediaStreamId) {
        console.log(`⚠️  No active recording found for call: ${callId}`);
        return null;
      }

      const streamId = call.antMediaStreamId;

      // Stop stream (this also stops recording)
      await antMediaService.stopStream(streamId);

      // Update call status
      await Call.findOneAndUpdate(
        { callId },
        {
          recordingStatus: "processing",
        }
      );

      // Wait longer for ANT Media to finalize the recording
      // ANT Media needs time to process and save the MP4 file
      console.log(`⏳ Waiting 30 seconds for ANT Media to finalize recording...`);
      await this.sleep(30000); // Wait 30 seconds

      // Try multiple file name patterns (ANT Media uses different naming based on settings)
      const possibleFilenames = [
        `${streamId}.mp4`,
        `${streamId}_240p.mp4`,
        `${streamId}_360p.mp4`,
        `${streamId}_480p.mp4`,
        `${streamId}_720p.mp4`,
        `${streamId}_1080p.mp4`,
        `${streamId}_240p500kbps.mp4`,
        `${streamId}_360p800kbps.mp4`,
        `${streamId}_480p1000kbps.mp4`,
        `${streamId}_720p2000kbps.mp4`,
        `${streamId}_Adaptive.mp4`,
      ];

      let recordingBuffer = null;
      let usedFilename = null;

      for (const filename of possibleFilenames) {
        try {
          console.log(`🔍 Attempting to download: ${filename}`);
          recordingBuffer = await antMediaService.downloadRecording(streamId, filename);
          usedFilename = filename;
          console.log(`✅ Successfully downloaded: ${filename}`);
          break;
        } catch (error) {
          console.log(`⚠️  File not found: ${filename}`);
        }
      }

      if (!recordingBuffer) {
        console.error(`❌ No recording file found after trying all patterns`);
        
        await Call.findOneAndUpdate(
          { callId },
          {
            recordingStatus: "no_recording",
            recordingError: "Recording file not found on ANT Media Server. Please enable MP4 recording in ANT Media dashboard.",
          }
        );
        
        return null;
      }

      // Upload to S3
      const uploadResult = await this.uploadToS3(callId, recordingBuffer, call.callType);

      // Update call with recording info
      await Call.findOneAndUpdate(
        { callId },
        {
          recordingUrl: uploadResult.url,
          recordingS3Key: uploadResult.key,
          recordingStatus: "completed",
          recordingSize: uploadResult.size,
        }
      );

      // Clean up ANT Media stream
      await antMediaService.deleteStream(streamId);

      console.log(`✅ Recording uploaded to S3: ${uploadResult.url}`);
      console.log(`📊 File size: ${(uploadResult.size / 1024 / 1024).toFixed(2)} MB`);
      
      return uploadResult;
    } catch (error) {
      console.error(`❌ Error stopping call recording for ${callId}:`, error.message);
      
      // Update call with error status
      await Call.findOneAndUpdate(
        { callId },
        {
          recordingStatus: "failed",
          recordingError: error.message,
        }
      );
      
      return null;
    }
  }

  /**
   * Upload recording to S3
   * @param {string} callId - Call ID
   * @param {Buffer} fileBuffer - Recording file buffer
   * @param {string} callType - Call type (voice/video)
   * @returns {Promise<object>} Upload result with URL and key
   */
  async uploadToS3(callId, fileBuffer, callType) {
    try {
      console.log(`☁️  Uploading recording to S3 for call: ${callId}`);
      
      // Optional: Apply audio enhancement using FFmpeg (if installed)
      let processedBuffer = fileBuffer;
      try {
        processedBuffer = await this.enhanceAudioQuality(fileBuffer, callType);
      } catch (enhanceError) {
        console.log(`ℹ️  Audio enhancement skipped: ${enhanceError.message}`);
        // Use original buffer if enhancement fails
      }
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `recordings/${callType}/${callId}_${timestamp}.mp4`;

      const uploadParams = {
        Bucket: this.bucketName,
        Key: fileName,
        Body: processedBuffer,
        ContentType: "video/mp4",
        Metadata: {
          callId: callId,
          callType: callType,
          uploadedAt: new Date().toISOString(),
        },
      };

      // Upload to S3
      const command = new PutObjectCommand(uploadParams);
      await this.s3Client.send(command);

      // Generate S3 URL
      const s3Url = `https://${this.bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;

      console.log(`✅ Recording uploaded to S3: ${s3Url}`);

      return {
        url: s3Url,
        key: fileName,
        size: processedBuffer.length,
        bucket: this.bucketName,
      };
    } catch (error) {
      console.error(`❌ Error uploading to S3:`, error.message);
      throw error;
    }
  }

  /**
   * Enhance audio quality using FFmpeg
   * Applies noise reduction, normalization, and compression
   * @param {Buffer} inputBuffer - Original MP4 buffer
   * @param {string} callType - Call type
   * @returns {Promise<Buffer>} Enhanced audio buffer
   */
  async enhanceAudioQuality(inputBuffer, callType) {
    const ffmpeg = require('fluent-ffmpeg');
    const fs = require('fs').promises;
    const path = require('path');
    const os = require('os');

    return new Promise(async (resolve, reject) => {
      // Skip enhancement if FFmpeg is not available
      try {
        require.resolve('fluent-ffmpeg');
      } catch (e) {
        return reject(new Error('FFmpeg not installed'));
      }

      const tempDir = os.tmpdir();
      const inputFile = path.join(tempDir, `input_${Date.now()}.mp4`);
      const outputFile = path.join(tempDir, `output_${Date.now()}.mp4`);

      try {
        console.log(`🎵 Enhancing audio quality with FFmpeg...`);

        // Write input buffer to temp file
        await fs.writeFile(inputFile, inputBuffer);

        // Apply FFmpeg audio filters for MAXIMUM quality enhancement
        // ULTRA AGGRESSIVE MODE - Remove ALL noise
        ffmpeg(inputFile)
          // First normalize input audio
          .audioFilters([
            'volume=2.0',                  // Pre-boost volume
            'highpass=f=200',              // First pass: Remove very low rumble
            'lowpass=f=3500',              // Keep full voice range
            'afftdn=nf=-30:tn=1',          // MAXIMUM noise reduction (-30dB) with tracking
            'anlmdn=s=15:p=0.001:r=0.001:m=15', // EXTREME noise reduction (increased strength)
            'highpass=f=300',              // Second pass: Remove remaining rumble
            'lowpass=f=3400',              // Voice range only (telephone quality)
            'afftdn=nf=-35:tn=1',          // THIRD noise reduction pass (even stronger)
            'loudnorm=I=-14:TP=-1.0:LRA=7', // Aggressive normalization
            'equalizer=f=500:t=q:w=1:g=2',  // Boost low voice
            'equalizer=f=1000:t=q:w=1:g=4', // BOOST voice frequencies more
            'equalizer=f=2000:t=q:w=1:g=3', // BOOST presence more
            'equalizer=f=3000:t=q:w=1:g=2', // Boost clarity
            'compand=attacks=0.1:decays=0.4:points=-80/-80|-50/-50|-30/-25|-10/-10|0/-5:soft-knee=6:gain=8', // MUCH stronger compression
            'deesser',                     // Remove harsh "s" sounds
            'afftdn=nf=-25',               // FOURTH pass for any remaining noise
            'highpass=f=150',              // Final cleanup pass
            'volume=1.5',                  // Post-boost for clarity
          ])
          // Audio codec settings - MAXIMUM quality
          .audioCodec('aac')
          .audioBitrate('256k')            // Increase to 256kbps for MAXIMUM quality
          .audioFrequency(48000)
          .audioChannels(1)                // Mono
          // Video codec (copy without re-encoding for speed)
          .videoCodec('copy')
          // Output
          .output(outputFile)
          .on('start', (commandLine) => {
            console.log('🎬 FFmpeg command:', commandLine);
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              console.log(`⏳ Processing: ${progress.percent.toFixed(1)}%`);
            }
          })
          .on('end', async () => {
            try {
              console.log('✅ Audio enhancement completed');
              
              // Read enhanced file
              const enhancedBuffer = await fs.readFile(outputFile);
              
              // Cleanup temp files
              await fs.unlink(inputFile).catch(() => {});
              await fs.unlink(outputFile).catch(() => {});
              
              resolve(enhancedBuffer);
            } catch (readError) {
              reject(readError);
            }
          })
          .on('error', async (err) => {
            console.error('❌ FFmpeg error:', err.message);
            
            // Cleanup temp files
            await fs.unlink(inputFile).catch(() => {});
            await fs.unlink(outputFile).catch(() => {});
            
            reject(err);
          })
          .run();
      } catch (error) {
        // Cleanup on error
        await fs.unlink(inputFile).catch(() => {});
        await fs.unlink(outputFile).catch(() => {});
        reject(error);
      }
    });
  }

  /**
   * Check if recording exists in S3
   * @param {string} s3Key - S3 object key
   * @returns {Promise<boolean>} True if exists
   */
  async recordingExistsInS3(s3Key) {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
      });

      await this.s3Client.send(command);
      return true;
    } catch (error) {
      if (error.name === "NotFound") {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get recording URL from call
   * @param {string} callId - Call ID
   * @returns {Promise<string|null>} Recording URL or null
   */
  async getRecordingUrl(callId) {
    try {
      const call = await Call.findOne({ callId });
      
      if (!call || !call.recordingUrl) {
        return null;
      }

      return call.recordingUrl;
    } catch (error) {
      console.error(`❌ Error getting recording URL for ${callId}:`, error.message);
      return null;
    }
  }

  /**
   * Handle recording failure/cleanup on call disconnect
   * @param {string} callId - Call ID
   */
  async handleRecordingCleanup(callId) {
    try {
      console.log(`🧹 Cleaning up recording for call: ${callId}`);
      
      const call = await Call.findOne({ callId });
      
      if (!call || !call.antMediaStreamId) {
        return;
      }

      const streamId = call.antMediaStreamId;

      // Stop recording if still active
      await antMediaService.stopRecording(streamId);
      
      // Stop stream
      await antMediaService.stopStream(streamId);
      
      // Delete stream (cleanup)
      await antMediaService.deleteStream(streamId);

      console.log(`✅ Recording cleanup completed for call: ${callId}`);
    } catch (error) {
      console.error(`❌ Error during recording cleanup for ${callId}:`, error.message);
    }
  }

  /**
   * Sleep utility
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Export singleton instance
module.exports = new RecordingService();
