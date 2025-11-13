const axios = require("axios");

/**
 * ANT Media Server Service
 * Handles all interactions with ANT Media Server for call recording
 */
class AntMediaService {
  constructor() {
    this.baseUrl = process.env.ANT_MEDIA_REST_URL;
    this.username = process.env.ANT_MEDIA_USERNAME;
    this.password = process.env.ANT_MEDIA_PASSWORD;
    this.authToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Authenticate with ANT Media Server and get JWT token
   * Note: Some ANT Media installations don't require authentication
   */
  async authenticate() {
    try {
      // Check if token is still valid
      if (this.authToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
        return this.authToken;
      }

      // Try to authenticate if credentials are provided
      if (!this.username || !this.password) {
        console.log("ℹ️  No ANT Media credentials provided, using no authentication");
        return null;
      }

      console.log("🔐 Attempting ANT Media Server authentication...");
      
      try {
        const response = await axios.post(
          `${this.baseUrl}/users/authenticate`,
          {
            email: this.username,
            password: this.password,
          },
          {
            headers: {
              "Content-Type": "application/json",
            },
          }
        );

        if (response.data && response.data.jwtToken) {
          this.authToken = response.data.jwtToken;
          // Token expires in 24 hours, set expiry 1 hour before that
          this.tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
          console.log("✅ ANT Media Server authentication successful");
          return this.authToken;
        }
      } catch (authError) {
        // Authentication endpoint might not exist - try without auth
        console.log("ℹ️  Authentication endpoint not available, will try without authentication");
        return null;
      }
      
      return null;
    } catch (error) {
      console.error("❌ ANT Media authentication error:", error.message);
      return null;
    }
  }

  /**
   * Get authentication headers
   */
  async getAuthHeaders() {
    const token = await this.authenticate();
    const headers = {
      "Content-Type": "application/json",
    };
    
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    
    return headers;
  }

  /**
   * Create a new broadcast stream for recording
   * @param {string} streamId - Unique stream ID (e.g., callId)
   * @param {string} streamName - Human-readable stream name
   * @returns {Promise<object>} Stream creation response
   */
  async createStream(streamId, streamName) {
    try {
      console.log(`📹 Creating ANT Media stream: ${streamId}`);
      
      const headers = await this.getAuthHeaders();
      
      // For WebRTC streaming, we don't need to pre-create the stream
      // ANT Media will auto-create it when WebRTC connection starts
      // But we can register it for recording with optimized audio settings
      const streamData = {
        name: streamName,
        streamId: streamId,
        mp4Enabled: 1, // Enable MP4 recording
        webMEnabled: 0,
      };

      const response = await axios.post(
        `${this.baseUrl}/broadcasts/create`,
        streamData,
        { headers }
      );

      console.log(`✅ Stream created: ${streamId}`, response.data);
      return response.data;
    } catch (error) {
      console.error(`❌ Error creating stream ${streamId}:`, error.message);
      if (error.response) {
        console.error("Response data:", error.response.data);
      }
      
      // For WebRTC, stream might be created automatically, so this error is OK
      // We'll just log it and continue
      console.log(`ℹ️  Stream will be auto-created by ANT Media when call starts`);
      return { success: true, streamId: streamId, message: "Stream will be auto-created" };
    }
  }

  /**
   * Start recording a stream
   * @param {string} streamId - Stream ID to start recording
   * @returns {Promise<object>} Recording start response
   */
  async startRecording(streamId) {
    try {
      console.log(`⏺️  Starting recording for stream: ${streamId}`);
      
      const headers = await this.getAuthHeaders();
      
      const response = await axios.post(
        `${this.baseUrl}/broadcasts/${streamId}/recording/true`,
        {},
        { headers }
      );

      console.log(`✅ Recording started for stream: ${streamId}`);
      return response.data;
    } catch (error) {
      console.error(`❌ Error starting recording for ${streamId}:`, error.message);
      if (error.response) {
        console.error("Response data:", error.response.data);
      }
      throw error;
    }
  }

  /**
   * Stop recording a stream
   * @param {string} streamId - Stream ID to stop recording
   * @returns {Promise<object>} Recording stop response
   */
  async stopRecording(streamId) {
    try {
      console.log(`⏹️  Stopping recording for stream: ${streamId}`);
      
      const headers = await this.getAuthHeaders();
      
      const response = await axios.post(
        `${this.baseUrl}/broadcasts/${streamId}/recording/false`,
        {},
        { headers }
      );

      console.log(`✅ Recording stopped for stream: ${streamId}`);
      return response.data;
    } catch (error) {
      console.error(`❌ Error stopping recording for ${streamId}:`, error.message);
      if (error.response) {
        console.error("Response data:", error.response.data);
      }
      // Don't throw error on stop, just log it
      return null;
    }
  }

  /**
   * Stop a broadcast stream
   * @param {string} streamId - Stream ID to stop
   * @returns {Promise<object>} Stop response
   */
  async stopStream(streamId) {
    try {
      console.log(`🛑 Stopping stream: ${streamId}`);
      
      const headers = await this.getAuthHeaders();
      
      const response = await axios.post(
        `${this.baseUrl}/broadcasts/${streamId}/stop`,
        {},
        { headers }
      );

      console.log(`✅ Stream stopped: ${streamId}`);
      return response.data;
    } catch (error) {
      console.error(`❌ Error stopping stream ${streamId}:`, error.message);
      // Don't throw error on stop, just log it
      return null;
    }
  }

  /**
   * Get recording details/files for a stream
   * @param {string} streamId - Stream ID to get recordings for
   * @returns {Promise<Array>} List of recording files
   */
  async getRecordings(streamId) {
    try {
      console.log(`📁 Getting recordings for stream: ${streamId}`);
      
      const headers = await this.getAuthHeaders();
      
      const response = await axios.get(
        `${this.baseUrl}/broadcasts/${streamId}/recording/list`,
        { headers }
      );

      console.log(`✅ Found recordings for stream: ${streamId}`, response.data);
      return response.data || [];
    } catch (error) {
      console.error(`❌ Error getting recordings for ${streamId}:`, error.message);
      if (error.response) {
        console.error("Response data:", error.response.data);
      }
      return [];
    }
  }

  /**
   * Delete a stream
   * @param {string} streamId - Stream ID to delete
   * @returns {Promise<object>} Delete response
   */
  async deleteStream(streamId) {
    try {
      console.log(`🗑️  Deleting stream: ${streamId}`);
      
      const headers = await this.getAuthHeaders();
      
      const response = await axios.delete(
        `${this.baseUrl}/broadcasts/${streamId}`,
        { headers }
      );

      console.log(`✅ Stream deleted: ${streamId}`);
      return response.data;
    } catch (error) {
      console.error(`❌ Error deleting stream ${streamId}:`, error.message);
      // Don't throw error on delete, just log it
      return null;
    }
  }

  /**
   * Get stream information
   * @param {string} streamId - Stream ID to get info for
   * @returns {Promise<object>} Stream information
   */
  async getStreamInfo(streamId) {
    try {
      const headers = await this.getAuthHeaders();
      
      const response = await axios.get(
        `${this.baseUrl}/broadcasts/${streamId}`,
        { headers }
      );

      return response.data;
    } catch (error) {
      console.error(`❌ Error getting stream info for ${streamId}:`, error.message);
      return null;
    }
  }

  /**
   * Download recording file from ANT Media Server
   * @param {string} streamId - Stream ID
   * @param {string} recordingFile - Recording filename
   * @returns {Promise<Buffer>} Recording file buffer
   */
  async downloadRecording(streamId, recordingFile) {
    try {
      console.log(`📥 Downloading recording: ${recordingFile} for stream: ${streamId}`);
      
      // ANT Media recordings are typically stored at:
      // http://server:port/WebRTCAppEE/streams/{streamId}.mp4
      const recordingUrl = `${process.env.ANT_MEDIA_SERVER_URL}/streams/${recordingFile}`;
      
      console.log(`📥 Downloading from URL: ${recordingUrl}`);
      
      const response = await axios.get(recordingUrl, {
        responseType: "arraybuffer",
        timeout: 300000, // 5 minutes timeout for large files
      });

      console.log(`✅ Recording downloaded: ${recordingFile} (${response.data.length} bytes)`);
      return Buffer.from(response.data);
    } catch (error) {
      console.error(`❌ Error downloading recording ${recordingFile}:`, error.message);
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new AntMediaService();
