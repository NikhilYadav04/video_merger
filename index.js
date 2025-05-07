const express = require("express");
const multer = require("multer");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
const fs = require("fs-extra");
const path = require("path");
const cors = require("cors");

//* Ensure the FFmpeg binary path is set correctly
ffmpeg.setFfmpegPath(ffmpegStatic);

const app = express();
const PORT = 3000;

//* Create and ensure the upload directory exists\ 
const uploadDir = path.join(__dirname, "uploads");
fs.ensureDirSync(uploadDir);

//* Configure multer storage settings
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    //* Store all incoming files in the uploads directory
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    //* Use a timestamp plus sanitized original filename to avoid collisions
    const ts = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-]/g, "_");
    cb(null, `${ts}_${safeName}`);
  },
});

//* Limit uploads to an array of up to 5 videos under the field name 'videos'
const upload = multer({ storage }).array("videos", 5);

//* Enable CORS for all routes
app.use(cors());

//* Root endpoint for testing
app.get("/", (req, res) => {
  res.send("Welcome to the Video Merge Service");
});

//* Merge endpoint to concatenate uploaded videos
app.post("/merge", (req, res) => {
  console.log("/merge called");

  //* Handle file uploads with multer
  upload(req, res, async (err) => {
    if (err) {
      //* Upload error handling
      return res.status(500).json({ error: "Upload failed", details: err.message });
    }

    const files = req.files;
    if (!files || files.length < 2) {
      //* Ensure at least two videos are provided
      return res.status(400).json({ error: "Please upload at least 2 videos to merge" });
    }

    //* Prepare a temporary concat list file for FFmpeg
    const concatListPath = path.join(uploadDir, `concat_${Date.now()}.txt`);

    try {
      //* Generate list entries: file '/path/to/video'
      const listContent = files
        .map(file => `file '${file.path.replace(/\\/g, "/")}'`)
        .join("\n");

      await fs.writeFile(concatListPath, listContent);

      const outputPath = path.join(uploadDir, `merged_${Date.now()}.mp4`);
      console.log("Concat file content:\n", listContent);

      //* Run FFmpeg with concat demuxer
      ffmpeg()
        .input(concatListPath)
        .inputOptions(["-f", "concat", "-safe", "0"])
        .outputOptions(["-preset", "fast"])
        .on("error", async ffErr => {
          //* FFmpeg processing error handling
          console.error("FFmpeg error:", ffErr);
          await cleanup(files, concatListPath, null);
          res.status(500).json({ error: "Video merge failed", details: ffErr.message });
        })
        .on("end", async () => {
          //* On success, send the merged file to the client
          res.download(outputPath, "merged.mp4", async sendErr => {
            //* Cleanup temporary files after download
            await cleanup(files, concatListPath, outputPath);
            if (sendErr) console.error("Error sending file:", sendErr);
          });
        })
        .save(outputPath);
    } catch (e) {
      //* General server-side error handling
      console.error("Processing error:", e);
      await fs.remove(concatListPath).catch(() => {});
      res.status(500).json({ error: "Server error", details: e.message });
    }
  });
});

//* Helper function to clean up uploaded and temp files
async function cleanup(uploadedFiles, listFile, mergedFile) {
  try {
    for (const file of uploadedFiles) {
      await fs.remove(file.path);    //* Remove each uploaded file
    }
    if (listFile) await fs.remove(listFile);  //* Remove concat list file
    if (mergedFile) await fs.remove(mergedFile);//* Remove merged output file
  } catch (cleanupErr) {
    console.error("Cleanup failed:", cleanupErr);
  }
}

//* Start the server
app.listen(PORT, () => console.log(`Video merge server listening on port ${PORT}`));
