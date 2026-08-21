---
title: "Digital Asset Management Methodology for 2D & 3D Artists and Designers"
slug: "digital-asset-management-methodology-for-2d-3d-artists-and-designers"
wordpress_id: 239469
status: "published"
source_url: "https://dirtybarn.com/digital-asset-management-methodology-for-2d-3d-artists-and-designers/"
legacy_url: "/digital-asset-management-methodology-for-2d-3d-artists-and-designers/"
permalink: "/digital-asset-management-methodology-for-2d-3d-artists-and-designers/"
excerpt: "Our guide to streamline digital asset management with file naming conventions, folder structures, and automation scripts. A workflow guide for creatives."
cover: "/media/posts/digital-asset-management-methodology-for-2d-3d-artists-and-designers/cover.jpg"
author:
  id: 2
  name: ""
categories:
  - "Others"
tags:
  - "asset management"
  - "digital asset management"
videos: []
published_at: "2024-12-03T09:08:30"
updated_at: "2024-12-03T09:09:17"
---

I have been thinking about this topic for a while. I have an asset management flow that is always different in each project, and even when projects are somehow similar to each other, they might have different requirements. Of course, since I don’t follow a standard procedure, this can complicate things in ongoing or extensive projects. I’m not that bad at renaming exports, but when I’m actively working on a project, like most designers, I might skip the renaming in order not to disrupt my flow, which can actually lead to crises in projects that need to go back to previous versions or projects with too many stakeholders and deliverables. This has always been an issue that I get angry at myself about, but unfortunately, unorganized asset management can still be a waste of time. So it made sense to streamline my 3D digital asset management methodology first.

[![](/media/posts/digital-asset-management-methodology-for-2d-3d-artists-and-designers/image-01.jpg)](https://dirtybarn.com/wp-content/uploads/2024/11/dirtybarn_folders.jpg)

## Focusing on the Project Scope First

I usually create in 3D, but sometimes it can also shift to 2D animation or Augmented Reality projects. So I will set up a primarily 3D assets-focused system for myself. The first thing I did was to research to see if anyone had written about this topic before. The most professional and on-point approach was made by Justin McClure Creative. They shared their “[Get Your Shit Together](https://justinmcclure.com/gyst)” system on their website with free downloadable files. But I’m not a fan of folders—the fewer, the better. So I need something simple. Also want to streamline the file naming, so let’s start with that.

## File Naming Structure

The most important thing for me here is that the naming should be simple and clear. I don’t like complex nomenclature guidelines. And whenever I receive a project file from another studio, I need to rename it because every studio uses their own file name guidelines. Yes, maybe the file name is neatly organized, but it will take maybe a minute to write it. My naming format will be like this:

```
<client name>_<project short name>_<project short name>_<medium information (if necessary)>v<version number>
```

It might seem simple and straightforward but it’s fine. For example “Nike\_LogoAnimation\_v2”. I like its simplicity, and it’s definitely enough. There’s information on who I’m working with, a short name to describe the project and the latest version. Maybe medium information could have been added. That’s why I put that part optionally. If it’s really necessary, it can be added, such as “Nike\_LogoAnimation\_Video\_v2”.

## Version Control

I usually approach the version history section similarly to developers. Unless there are important steps, I primarily update the decimals. It basically goes like this: “v1, v1\_1, v1\_2, v1\_3” and so on. And whenever an important milestone is completed, I update the integer number, which is actually very beneficial. In hindsight, I can see where there was a big change.

## Now let’s get back to folder structure:

```
[PROJECT]-[DATE]
├── 01-INCOMING
├── 02-ASSETS
│   ├── 01_DOCS
│   ├── 02_IMAGES
│   ├── 03_VECTORS
│   ├── 04_LOGOS
│   ├── 05_FONTS
│   ├── 06_3D
│   ├── 07_AUDIOS
│   ├── 08_FOOTAGE
│   └── 09_OTHERS
├── 03-RESEARCH
├── 04-SOURCES
│   ├── 01_BLENDER
│   ├── 02_AE
│   ├── 03_PSD
│   ├── 04_AI
│   ├── 05_AR
│   └── 06_OTHERS
├── 05-OUTPUTS
│   ├── 00_RENDERS
│   └── 01_PREVIEWS
├── 06-REVIEW
├── 07-DELIVERY
├── 08-ARCHIVED
└── 09-OTHERS
```

## Folder Descriptions

1. **Incoming**: This folder is going to be the first stop where I put everything that comes from whomever, the brand or artist I’m currently working with. Some people might prefer creating subfolders for each purpose, such as legal, branding, and so on. But I usually don’t need these subfolders since I don’t request those documents that much.
2. **Assets**: It’s pretty self-explanatory actually. I don’t like having so many folders underneath, but in this context it is necessary. I can come back to this folder whenever necessary and can look retrospectively, so organization is essential here.
3. **Research**: The research part of the project will be stored here. It can serve as a repository of moodboards and citations before starting the work. Also, this folder can act as a reference point and can contribute to the flow of the project itself.
4. **Sources**: Here is the most important folder. I usually use Blender and Adobe After Effects very frequently, so they have become primary areas for me. You can also revise the subfolders according to your priorities.
5. **Outputs**: This is where I render and export the animations, still frames, or previews that I have made. If it is a project with a lot of preview drafts, it might be good to create a subfolder for them here with dates. For example, creating a folder named “181124” to store the preview drafts exported on that day. In this way, this directory will not be complicated to navigate and you can quickly travel back in time when you need to return later.
6. **Review**: This is where I put out the work that I have prepared to send to the team or to the client. It is important to make a coherent order here as much as possible to not create chaos. Naming with the versions makes it easier to keep track of the revision process and makes it easier to go back.
7. **Delivery**: When I’m ready to share the approved final versions, this directory is the go-to location. Separating drafted versions and finals helps me to differentiate and avoid making mistakes on delivery.
8. **Archived**: This folder’s purpose is to store the crucial primary files after the project is completed. Every project requires archiving on some level. Separating the important files for later reference is always helpful.
9. **Others**: This is basically a “Temp” folder where I dump all the files that don’t fit into the folders above. With this folder, I conclude to summarize my simplest file system.

[![](/media/posts/digital-asset-management-methodology-for-2d-3d-artists-and-designers/cover.jpg)](https://dirtybarn.com/wp-content/uploads/2024/11/dirtybarn_folders_2.jpg)

## Automation Scripts

Now I’m moving on to the second phase, automation. Whenever I start a new project, I want these folders to be created with one click. Of course, it is also possible to make a template folder and copy and paste it from there, but I know that I will definitely delete that template by mistake. So I prepared simple lines of code below. This is designed as a .bat file. Whenever it opens, creates the folders above in the current directory, and asks you to write a project name. Then it creates the directory as “PROJECT NAME\_Month\_Year”.

Let’s say you typed “NIKE\_LOGO\_ANIMATION”. It will be created as NIKE\_LOGO\_ANIMATION\_11\_24.

```
@echo off
:: Get the current directory from the parameter
set currentDir=%1

:: Ensure the path does not have quotes
set currentDir=%currentDir:"=%

:: Get the system date (parsed in DD/MM/YYYY format)
for /f "tokens=1-3 delims=./-" %%a in ('echo %date%') do (
    set day=%%a
    set month=%%b
    set year=%%c
)

:: Extract the last two digits of the year
set shortYear=%year:~2,2%

:: Get the folder name from the user
set /p rootFolder=Enter the folder name:

:: Combine folder name with month and year
set folderName=%currentDir%\%rootFolder%_%month%_%shortYear%

:: Create the folder structure
mkdir "%folderName%"
cd "%folderName%"
mkdir "01-INCOMING"
cd "01-INCOMING"
mkdir "01_DOCS" "02_IMAGES" "03_VECTORS" "04_LOGOS" "05_FONTS" "06_3D" "07_AUDIOS" "08_FOOTAGE" "09_OTHERS"
cd ..

mkdir "02-ASSETS"
cd "02-ASSETS"
mkdir "01_DOCS" "02_IMAGES" "03_VECTORS" "04_LOGOS" "05_FONTS" "06_3D" "07_AUDIOS" "08_FOOTAGE" "09_OTHERS"
cd ..

mkdir "03-RESEARCH"
mkdir "04-SOURCES"
cd "04-SOURCES"
mkdir "01_BLENDER" "02_AE" "03_PSD" "04_AI" "05_AR" "06_OTHERS"
cd ..

mkdir "05-OUTPUTS"
cd "05-OUTPUTS"
mkdir "00_RENDERS" "01_PREVIEWS"
cd ..

mkdir "06-REVIEW"
mkdir "07-DELIVERY"
mkdir "08-ARCHIVED"
mkdir "09-OTHERS"

echo %folderName% folder and subfolders were successfully created!
pause
```

### Registry Script

Now let’s make it easier to access this automation flow. I want to create all these folders with a single click by right-clicking on an empty space. Let’s save the .bat file, let’s say script.bat, in a directory and add this directory to the registry. Create a file called “AddCreateTemplate.reg” and add the following code below. You need to update the “C:\\\\path\\\\to\\your\\\\script.bat\\” by using a notepad software. Then run this into the “AddCreateTemplate.reg” file.

```
Windows Registry Editor Version 5.00

[HKEY_CLASSES_ROOT\Directory\Background\shell\Create Project Template]
@="Create Project Template"
"Icon"="cmd.exe"

[HKEY_CLASSES_ROOT\Directory\Background\shell\Create Project Template\command]
@="\"C:\\path\\to\\your\\script.bat\" \"%V\""
```

All done! It does not appear directly with a right click. So you may need to close and open Explorer.exe.

[![](/media/posts/digital-asset-management-methodology-for-2d-3d-artists-and-designers/image-02.jpg)](https://dirtybarn.com/wp-content/uploads/2024/11/file-dirtybarn-1.jpg)

Let’s test it now. I created an empty folder, right-clicked on it, and clicked Create Project Template. I typed DIRTYBARN in the window that appeared.

[![](/media/posts/digital-asset-management-methodology-for-2d-3d-artists-and-designers/image-03.png)](https://dirtybarn.com/wp-content/uploads/2024/11/WindowsTerminal_UsZewATTI8.png)

Hit enter and all looks good!

[![](/media/posts/digital-asset-management-methodology-for-2d-3d-artists-and-designers/image-04.png)](https://dirtybarn.com/wp-content/uploads/2024/11/explorer_IHorKICwuF.png)

## Key Learnings

1. File naming should be as simple as possible, and standardized, and everything should be in a unified language.
2. Vinzent Britz’s [File management for motion designers](https://medium.com/@vinzent/file-management-for-motion-designers-d41bfeeea1b6#:~:text=The%20naming%20of%20your%20files&text=However%20you%20name%20your%20files,version%2C%20again%20—%20be%20consistent.&text=Everything%20is%20English.) article was pretty on point about file naming practices and it makes perfect sense. Never add file names like “FINAL” or “NEW”. A file is never the final version the first time, and there will be countless “FINAL” files in the project.
3. Upgrade the same version internally unless there are major steps: “v1, v1\_1, v1\_2…” and so on. Upgrade the number after something important happens. This provides good historical tracking of significant changes.
4. Don’t use spaces in file names. Use underscores only and write similar properties without space, such as “Nike\_ReelsVideo\_v1”. It’s much simpler.
5. Entering the date at the beginning in YYMMDD format is also an option. This makes sorting much smarter. For example: “241119\_Nike\_ReelsVideo\_v1”.
6. Avoid creating unnecessary directories in your folder structure if they don’t serve any benefit. For example, there’s no need to create separate folders for JPEG and PNG files in images in assets.
7. Archive the project when the final deliverables are approved. Clean up unused files and autosaves while you still have fresh memories about those files.
